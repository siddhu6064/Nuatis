// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "NuatisUI",
    platforms: [
        .iOS(.v17)
    ],
    products: [
        .library(
            name: "NuatisUI",
            targets: ["NuatisUI"]
        )
    ],
    targets: [
        .target(
            name: "NuatisUI"
        ),
        .testTarget(
            name: "NuatisUITests",
            dependencies: ["NuatisUI"]
        )
    ]
)
