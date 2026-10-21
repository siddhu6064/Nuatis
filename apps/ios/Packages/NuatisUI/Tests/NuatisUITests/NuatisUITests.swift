import Testing
import SwiftUI
@testable import NuatisUI

/// Verifies NuatisColor tokens actually resolve to the sRGB components
/// DESIGN.md specifies — not just that the file compiles. Uses
/// `Color.resolve(in:)` rather than UIKit so the tests build and run on any
/// host platform, independent of the package's iOS-only deployment target.
@Suite("NuatisColor token verification")
struct NuatisColorTests {

    private func srgbComponents(of color: Color) -> (r: Double, g: Double, b: Double) {
        let resolved = color.resolve(in: EnvironmentValues())
        return (Double(resolved.red), Double(resolved.green), Double(resolved.blue))
    }

    private func expectMatches(_ color: Color, hex: (UInt8, UInt8, UInt8)) {
        let expected = (r: Double(hex.0) / 255, g: Double(hex.1) / 255, b: Double(hex.2) / 255)
        let actual = srgbComponents(of: color)
        let tolerance = 0.004 // ~1/255, allows for floating-point rounding
        #expect(abs(actual.r - expected.r) < tolerance)
        #expect(abs(actual.g - expected.g) < tolerance)
        #expect(abs(actual.b - expected.b) < tolerance)
    }

    @Test("teal matches DESIGN.md #007A6E — the primary action token")
    func teal() {
        expectMatches(NuatisColor.teal, hex: (0x00, 0x7A, 0x6E))
    }

    @Test("orange matches DESIGN.md #E84A00 — the Maya/voice-reserved token")
    func orange() {
        expectMatches(NuatisColor.orange, hex: (0xE8, 0x4A, 0x00))
    }

    @Test("ink matches DESIGN.md #0E0E0E — primary text")
    func ink() {
        expectMatches(NuatisColor.ink, hex: (0x0E, 0x0E, 0x0E))
    }

    @Test("orangeBorder matches DESIGN.md §4 #FFB899 — running/live badge border")
    func orangeBorder() {
        expectMatches(NuatisColor.orangeBorder, hex: (0xFF, 0xB8, 0x99))
    }

    @Test("rose resolves identically to red — documented alias, not a separate value")
    func roseAliasesRed() {
        let rose = srgbComponents(of: NuatisColor.rose)
        let red = srgbComponents(of: NuatisColor.red)
        #expect(rose.r == red.r)
        #expect(rose.g == red.g)
        #expect(rose.b == red.b)
    }
}
