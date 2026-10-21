import Testing
import CoreText
@testable import NuatisUI

/// Fails if a bundled font is missing, misnamed, or silently falls back to
/// a system font — `CTFontCreateWithName` degrades to Helvetica rather than
/// erroring, so a name mismatch would otherwise pass silently.
@Suite("NuatisFont registration")
struct NuatisFontRegistrationTests {

    @Test("all bundled fonts register without a real CoreText error")
    func registrationSucceeds() {
        #expect(NuatisFontRegistrar.registerIfNeeded())
    }

    @Test("every expected PostScript name resolves to itself, not a fallback",
          arguments: NuatisFontRegistrar.expectedPostScriptNames)
    func fontResolves(postScriptName: String) {
        NuatisFontRegistrar.registerIfNeeded()
        let font = CTFontCreateWithName(postScriptName as CFString, 12, nil)
        let resolvedName = CTFontCopyPostScriptName(font) as String
        #expect(resolvedName == postScriptName)
    }
}
