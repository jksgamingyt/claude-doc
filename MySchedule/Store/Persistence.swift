//
//  Persistence.swift
//  MySchedule
//
//  Everything lives in one JSON file inside Application Support. No server, no
//  account, no network. The file is written atomically and read defensively:
//  a note that fails to decode is skipped rather than taking the rest with it.
//

import Foundation

// MARK: - Decoding helpers

/// Decodes and throws away whatever is in front of it. Used to step past an
/// element that failed to decode without stalling the container.
private struct DiscardedValue: Decodable {
    init(from decoder: Decoder) throws {
        // Touch the container so malformed-but-present values are consumed.
        _ = try? decoder.singleValueContainer()
    }
}

/// An array that survives bad elements instead of failing the whole decode.
struct LossyArray<Element: Codable>: Codable {
    var elements: [Element]

    init(_ elements: [Element] = []) {
        self.elements = elements
    }

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        var result: [Element] = []
        var guardRail = 0

        while !container.isAtEnd && guardRail < 10_000 {
            guardRail += 1
            if let element = try? container.decode(Element.self) {
                result.append(element)
            } else {
                // Step over the broken element.
                _ = try? container.decode(DiscardedValue.self)
                if container.isAtEnd { break }
            }
        }

        self.elements = result
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.unkeyedContainer()
        for element in elements {
            try container.encode(element)
        }
    }
}

extension KeyedDecodingContainer {
    /// Decode if present and well-formed, otherwise fall back. Keeps the app
    /// loadable across future schema additions.
    func value<T: Decodable>(_ key: Key, or fallback: T) -> T {
        guard let decoded = try? decodeIfPresent(T.self, forKey: key) else { return fallback }
        return decoded ?? fallback
    }
}

// MARK: - The file on disk

struct StoreFile: Codable {
    var version: Int
    var temporaryNotes: [TemporaryNote]
    var permanentNotes: [PermanentNote]
    var archive: [ArchivedNote]
    var settings: AppSettings

    static let currentVersion = 1

    init(
        version: Int = StoreFile.currentVersion,
        temporaryNotes: [TemporaryNote] = [],
        permanentNotes: [PermanentNote] = [],
        archive: [ArchivedNote] = [],
        settings: AppSettings = .default
    ) {
        self.version = version
        self.temporaryNotes = temporaryNotes
        self.permanentNotes = permanentNotes
        self.archive = archive
        self.settings = settings
    }

    enum CodingKeys: String, CodingKey {
        case version, temporaryNotes, permanentNotes, archive, settings
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = container.value(.version, or: StoreFile.currentVersion)
        temporaryNotes = container.value(.temporaryNotes, or: LossyArray<TemporaryNote>()).elements
        permanentNotes = container.value(.permanentNotes, or: LossyArray<PermanentNote>()).elements
        archive = container.value(.archive, or: LossyArray<ArchivedNote>()).elements
        settings = container.value(.settings, or: AppSettings.default)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encode(LossyArray(temporaryNotes), forKey: .temporaryNotes)
        try container.encode(LossyArray(permanentNotes), forKey: .permanentNotes)
        try container.encode(LossyArray(archive), forKey: .archive)
        try container.encode(settings, forKey: .settings)
    }
}

// MARK: - Reading and writing

enum Persistence {

    static let fileName = "myschedule.json"

    static var directoryURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("MySchedule", isDirectory: true)
    }

    static var fileURL: URL {
        directoryURL.appendingPathComponent(fileName)
    }

    static var backupURL: URL {
        directoryURL.appendingPathComponent("myschedule.backup.json")
    }

    static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }

    static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    static func load() -> StoreFile {
        let manager = FileManager.default

        for url in [fileURL, backupURL] {
            guard manager.fileExists(atPath: url.path) else { continue }
            do {
                let data = try Data(contentsOf: url)
                let file = try makeDecoder().decode(StoreFile.self, from: data)
                return file
            } catch {
                // Try the backup next; if both are unreadable we start clean
                // rather than refusing to launch.
                continue
            }
        }

        return StoreFile()
    }

    @discardableResult
    static func save(_ file: StoreFile) -> Bool {
        let manager = FileManager.default
        do {
            if !manager.fileExists(atPath: directoryURL.path) {
                try manager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
            }

            // Roll the previous good copy into the backup slot first.
            if manager.fileExists(atPath: fileURL.path) {
                if manager.fileExists(atPath: backupURL.path) {
                    try? manager.removeItem(at: backupURL)
                }
                try? manager.copyItem(at: fileURL, to: backupURL)
            }

            let data = try makeEncoder().encode(file)
            try data.write(to: fileURL, options: [.atomic])

            var resourceValues = URLResourceValues()
            resourceValues.isExcludedFromBackup = false
            var mutableURL = fileURL
            try? mutableURL.setResourceValues(resourceValues)

            return true
        } catch {
            return false
        }
    }

    /// Used by the export sheet in Settings.
    static func exportData(_ file: StoreFile) -> Data? {
        try? makeEncoder().encode(file)
    }

    static func importData(_ data: Data) -> StoreFile? {
        try? makeDecoder().decode(StoreFile.self, from: data)
    }
}
