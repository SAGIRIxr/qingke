import Foundation

/// Pure time-selection logic. A line-for-line port of the Android `SchedulePlan` so both
/// platforms agree on which moments deserve a reminder; iOS only differs in delivery
/// (pre-registered calendar notifications instead of one rolling exact alarm).
public struct SchedulePlan {
    public static let minute: Int64 = 60_000

    public struct Segment: Equatable {
        public let start: Int64, end: Int64
        public init(start: Int64, end: Int64) { self.start = start; self.end = end }
    }

    public struct Event {
        public let id: String, name: String, location: String, type: String
        public let start: Int64, end: Int64
        /// When the timetable computed “即将上课” (same day, not after start); nil uses the fixed lead.
        public let remind: Int64?
        public let segments: [Segment]
        public init(id: String, name: String, location: String, start: Int64, end: Int64,
                    segments: [Segment], type: String = "course", remind: Int64? = nil) {
            self.id = id; self.name = name; self.location = location
            self.start = start; self.end = end; self.segments = segments; self.remind = remind
            self.type = type == "exam" ? "exam" : "course"
        }
        public var isExam: Bool { type == "exam" }
    }

    public enum Kind: Int { case reminder = 1, resume = 2, state = 3 }

    public struct Point {
        public let at: Int64, kind: Kind, event: Event
        public var key: String { "\(event.id)\n\(kind.rawValue)\n\(at)" }
    }

    public struct State {
        public let event: Event
        /// "before", "class" or "break".
        public let kind: String
        public let until: Int64, elapsed: Int64
    }

    public enum ParseError: Error, LocalizedError, Equatable {
        case invalid(String)
        public var errorDescription: String? { if case .invalid(let message) = self { return message }; return nil }
    }

    public let enabled: Bool, ongoing: Bool, breakReminder: Bool
    public let minutes: Int
    public let statusMode: String
    public let events: [Event]
    private let cachedPoints: [Point]

    public init(enabled: Bool, ongoing: Bool, breakReminder: Bool, minutes: Int, events: [Event], statusMode: String = "remaining") {
        self.enabled = enabled; self.ongoing = ongoing; self.breakReminder = breakReminder
        self.minutes = max(0, min(120, minutes))
        self.events = events
        self.statusMode = statusMode
        self.cachedPoints = SchedulePlan.buildPoints(enabled: enabled, ongoing: ongoing, breakReminder: breakReminder,
                                                     minutes: self.minutes, events: events)
    }

    // MARK: Parsing (same limits and messages as ScheduleNotifications.parse on Android)

    public static let maxJSONCharacters = 6_000_000

    public static func parse(json text: String) throws -> SchedulePlan {
        guard text.utf16.count <= maxJSONCharacters, let data = text.data(using: .utf8) else { throw ParseError.invalid("提醒计划过大") }
        guard let object = try? JSONSerialization.jsonObject(with: data), let root = object as? [String: Any] else {
            throw ParseError.invalid("提醒计划格式不正确")
        }
        return try parse(object: root)
    }

    public static func parse(object json: [String: Any]) throws -> SchedulePlan {
        let rows = json["events"] as? [Any] ?? []
        if rows.count > 12000 { throw ParseError.invalid("提醒计划最多支持 12000 次课程") }
        var events: [Event] = []
        var ids = Set<String>()
        for item in rows {
            guard let row = item as? [String: Any], let id = row["id"] as? String, let name = row["name"] as? String,
                  let start = integer(row["start"]), let end = integer(row["end"]) else {
                throw ParseError.invalid("课程时间或标识无效")
            }
            let location = row["location"] as? String ?? ""
            if id.isEmpty || id.utf16.count > 300 || !ids.insert(id).inserted || name.isEmpty || name.utf16.count > 300
                || location.utf16.count > 500 || start < 946_684_800_000 || end > 7_258_118_400_000
                || end <= start || end - start > 2 * 86_400_000 {
                throw ParseError.invalid("课程时间或标识无效")
            }
            var segments: [Segment] = []
            if let parts = row["segments"] as? [Any] {
                if parts.count > 40 { throw ParseError.invalid("课程小节过多") }
                for part in parts {
                    guard let value = part as? [String: Any], let a = integer(value["start"]), let b = integer(value["end"]) else {
                        throw ParseError.invalid("小节时间超出课程范围")
                    }
                    if a < start || b > end || b <= a { throw ParseError.invalid("小节时间超出课程范围") }
                    segments.append(Segment(start: a, end: b))
                }
            }
            if segments.isEmpty { segments.append(Segment(start: start, end: end)) }
            segments = stableSorted(segments) { $0.start }
            if segments.first!.start != start || segments.last!.end != end { throw ParseError.invalid("课程起止时间与小节不一致") }
            for index in 1..<max(1, segments.count) where segments[index].start < segments[index - 1].end {
                throw ParseError.invalid("课程小节时间重叠")
            }
            let type = row["type"] as? String ?? row["kind"] as? String ?? (id.hasPrefix("exam:") ? "exam" : "course")
            var remind: Int64?
            if row["remind"] != nil {
                guard let value = integer(row["remind"]), value <= start, start - value <= 86_400_000 else { throw ParseError.invalid("提醒时间无效") }
                remind = value
            }
            events.append(Event(id: id, name: name, location: location, start: start, end: end, segments: segments, type: type, remind: remind))
        }
        events = stableSorted(events) { $0.start }
        return SchedulePlan(enabled: boolean(json["enabled"]), ongoing: boolean(json["ongoing"]),
                            breakReminder: boolean(json["breakReminder"]), minutes: Int(integer(json["minutes"]) ?? 10),
                            events: events, statusMode: json["statusMode"] as? String ?? "remaining")
    }

    /// JSON numbers only (booleans are NSNumber too and must not count); numeric strings mirror org.json.
    static func integer(_ value: Any?) -> Int64? {
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return nil }
            let double = number.doubleValue
            guard double.isFinite, abs(double) < 9.0e15 else { return nil }
            return number.int64Value
        }
        if let text = value as? String, let parsed = Int64(text.trimmingCharacters(in: .whitespaces)) { return parsed }
        return nil
    }

    static func boolean(_ value: Any?) -> Bool {
        if let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue }
        if let text = value as? String { return text.lowercased() == "true" }
        return false
    }

    static func stableSorted<T>(_ values: [T], by key: (T) -> Int64) -> [T] {
        values.enumerated().sorted { lhs, rhs in
            let a = key(lhs.element), b = key(rhs.element)
            return a != b ? a < b : lhs.offset < rhs.offset
        }.map(\.element)
    }

    // MARK: Time selection

    private static func buildPoints(enabled: Bool, ongoing: Bool, breakReminder: Bool, minutes: Int, events: [Event]) -> [Point] {
        if !enabled && !ongoing { return [] }
        var points: [Point] = []
        for event in events {
            let before = event.remind ?? event.start - Int64(minutes) * minute
            if enabled { points.append(Point(at: before, kind: .reminder, event: event)) }
            if ongoing { points.append(Point(at: before, kind: .state, event: event)) }
            if ongoing { points.append(Point(at: event.start, kind: .state, event: event)) }
            points.append(Point(at: event.end, kind: .state, event: event))
            for (index, segment) in event.segments.enumerated() {
                if ongoing {
                    points.append(Point(at: segment.start, kind: .state, event: event))
                    points.append(Point(at: segment.end, kind: .state, event: event))
                }
                if enabled && breakReminder && index > 0 && segment.start > event.segments[index - 1].end {
                    points.append(Point(at: segment.start, kind: .resume, event: event))
                }
            }
        }
        return stableSorted(points) { $0.at }
    }

    public var points: [Point] { cachedPoints }

    public func nextAfter(_ now: Int64) -> Int64 {
        cachedPoints.first { $0.at > now }?.at ?? 0
    }

    /// iOS keeps at most 64 pending local notifications per app, so only the nearest alerts are
    /// registered; `hasMore` tells the caller to add a "please open the app" renewal notice.
    public func pendingAlerts(after now: Int64, limit: Int) -> (alerts: [Point], hasMore: Bool) {
        var result: [Point] = []
        for point in cachedPoints where point.kind != .state && point.at > now && point.event.end > point.at {
            if result.count == limit { return (result, true) }
            result.append(point)
        }
        return (result, false)
    }

    public func stateAt(_ now: Int64) -> State? {
        if !ongoing { return nil }
        var selected: Event?
        for event in events {
            if now >= event.end || now < (event.remind ?? event.start - Int64(minutes) * SchedulePlan.minute) { continue }
            if let current = selected {
                if (now >= event.start && now < current.start)
                    || ((now >= event.start) == (now >= current.start) && event.start < current.start) { selected = event }
            } else { selected = event }
        }
        guard let event = selected else { return nil }
        if now < event.start { return State(event: event, kind: "before", until: event.start, elapsed: 0) }
        var elapsed: Int64 = 0
        for segment in event.segments {
            if now < segment.start { return State(event: event, kind: "break", until: segment.start, elapsed: elapsed) }
            elapsed += max(0, min(now, segment.end) - segment.start)
            if now < segment.end { return State(event: event, kind: "class", until: segment.end, elapsed: elapsed) }
        }
        return State(event: event, kind: "class", until: event.end, elapsed: elapsed)
    }
}

/// Notification wording, identical to ScheduleNotifications.showReminder on Android.
public enum ReminderText {
    public static func content(for point: SchedulePlan.Point, timeZone: TimeZone = .current) -> (title: String, body: String) {
        let event = point.event
        let resume = point.kind == .resume
        let title = event.name + (resume ? " · 课间结束" : event.isExam ? " · 准备考试" : " · 准备上课")
        let place = event.location.isEmpty ? "地点未设置" : event.location
        let text = place + " · " + clock(resume ? point.at : event.start, timeZone) + (resume ? " 续课" : event.isExam ? " 开考" : " 上课")
        return (title, text + " · " + clock(event.end, timeZone) + (event.isExam ? " 结束" : " 下课"))
    }

    public static func clock(_ milliseconds: Int64, _ timeZone: TimeZone) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.hour, .minute], from: Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1000))
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }
}
