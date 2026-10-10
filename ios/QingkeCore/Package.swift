// swift-tools-version:5.7
import PackageDescription

// Pure Foundation logic shared by the iOS shell and `swift test` on macOS.
// Mirrors android/app/src/main/java/cn/qingke/app/{SchedulePlan,Share*Policy,ShareEntryInbox}.java.
let package = Package(
    name: "QingkeCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "QingkeCore", targets: ["QingkeCore"])],
    targets: [
        .target(name: "QingkeCore"),
        .testTarget(name: "QingkeCoreTests", dependencies: ["QingkeCore"]),
    ]
)
