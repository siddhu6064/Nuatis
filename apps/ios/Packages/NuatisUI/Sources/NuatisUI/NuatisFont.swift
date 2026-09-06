import SwiftUI
import CoreText
import CoreGraphics

/// Registers the bundled Epilogue and JetBrains Mono variable fonts with
/// CoreText. Swift package resources are not auto-registered the way an app
/// target's UIAppFonts entry is — the host app must call `registerIfNeeded()`
/// once at launch (see NuatisApp.swift init).
public enum NuatisFontRegistrar {

    /// PostScript names read directly from each file's `name` table, not
    /// guessed. Exposed so tests assert against the same list used here,
    /// rather than a second hardcoded copy that could drift.
    public static let expectedPostScriptNames = [
        "Epilogue-Regular",
        "Epilogue-Italic",
        "JetBrainsMono-Regular",
        "JetBrainsMono-Italic",
    ]

    private static let filenames = [
        "Epilogue-VariableFont_wght",
        "Epilogue-Italic-VariableFont_wght",
        "JetBrainsMono-VariableFont_wght",
        "JetBrainsMono-Italic-VariableFont_wght",
    ]

    /// A lazily-initialized `static let` runs its initializer exactly once,
    /// even under concurrent first access — Swift guarantees this without a
    /// lock, which is what makes repeated calls idempotent for free.
    @discardableResult
    public static func registerIfNeeded() -> Bool {
        registrationResult
    }

    private static let registrationResult: Bool = {
        var allSucceeded = true
        for filename in filenames {
            guard let url = Bundle.module.url(forResource: filename, withExtension: "ttf"),
                  let provider = CGDataProvider(url: url as CFURL),
                  let font = CGFont(provider) else {
                allSucceeded = false
                continue
            }
            var cfError: Unmanaged<CFError>?
            if !CTFontManagerRegisterGraphicsFont(font, &cfError) {
                // Registering an already-registered font also returns false;
                // that is not a real failure, so only count a genuine error.
                if let cfError, CFErrorGetCode(cfError.takeUnretainedValue()) != CTFontManagerError.alreadyRegistered.rawValue {
                    allSucceeded = false
                }
            }
        }
        return allSucceeded
    }()
}

/// A DESIGN.md §3 type-scale entry: font, line spacing, and letter-spacing
/// bundled together so callers don't reassemble them by hand.
public struct NuatisTextStyle: Sendable {
    public let font: Font
    /// `(line-height multiple − 1) × point size`, per DESIGN.md §3.
    /// Computed at the base point size — it does NOT scale with Dynamic
    /// Type, so leading stays fixed while the font itself grows at
    /// accessibility sizes. Known limitation; revisit in P12's
    /// accessibility pass, not fixed here.
    public let lineSpacing: CGFloat
    /// Non-zero only where a caller opts into the uppercase-label rule.
    public let kerning: CGFloat
}

extension Text {
    public func nuatisTextStyle(_ style: NuatisTextStyle) -> some View {
        self.font(style.font)
            .kerning(style.kerning)
            .lineSpacing(style.lineSpacing)
    }
}

/// DESIGN.md §3 type scale. Fraunces/marketing rows are deliberately not
/// implemented here — out of scope for the app per instruction.
public enum NuatisFont {

    private static func epilogue(size: CGFloat, weight: Font.Weight, relativeTo textStyle: Font.TextStyle) -> Font {
        Font.custom("Epilogue-Regular", size: size, relativeTo: textStyle).weight(weight)
    }

    private static func jetBrainsMono(size: CGFloat, weight: Font.Weight, relativeTo textStyle: Font.TextStyle) -> Font {
        Font.custom("JetBrainsMono-Regular", size: size, relativeTo: textStyle).weight(weight)
    }

    /// Page title (h1) — 24px/700/1.25.
    /// `relativeTo:` anchor is engineering judgment, not DESIGN.md canon —
    /// the spec gives no iOS Dynamic Type mapping.
    public static let pageTitle = NuatisTextStyle(
        font: epilogue(size: 24, weight: .bold, relativeTo: .title),
        lineSpacing: (1.25 - 1) * 24,
        kerning: 0
    )

    /// Section heading (h2) — 20px/600/1.3. `relativeTo:` is judgment, not canon.
    public static let sectionHeading = NuatisTextStyle(
        font: epilogue(size: 20, weight: .semibold, relativeTo: .title2),
        lineSpacing: (1.3 - 1) * 20,
        kerning: 0
    )

    /// Card title (h3) — 16px/600/1.4. `relativeTo:` is judgment, not canon.
    public static let cardTitle = NuatisTextStyle(
        font: epilogue(size: 16, weight: .semibold, relativeTo: .headline),
        lineSpacing: (1.4 - 1) * 16,
        kerning: 0
    )

    /// Body default — 14px/400/1.6. `relativeTo:` is judgment, not canon.
    public static let bodyDefault = NuatisTextStyle(
        font: epilogue(size: 14, weight: .regular, relativeTo: .body),
        lineSpacing: (1.6 - 1) * 14,
        kerning: 0
    )

    /// Body small — 13px/400/1.5. `relativeTo:` is judgment, not canon.
    public static let bodySmall = NuatisTextStyle(
        font: epilogue(size: 13, weight: .regular, relativeTo: .callout),
        lineSpacing: (1.5 - 1) * 13,
        kerning: 0
    )

    /// Label / caption — 12px/500/1.4. `relativeTo:` is judgment, not canon.
    /// For the ALL-CAPS section-header use case in §3's typography rules,
    /// use `sectionHeaderLabel` instead — this one carries no kerning so it
    /// stays correct for mixed-case captions too.
    public static let labelCaption = NuatisTextStyle(
        font: epilogue(size: 12, weight: .medium, relativeTo: .caption),
        lineSpacing: (1.4 - 1) * 12,
        kerning: 0
    )

    /// Same font/size/line-height as `labelCaption`, plus the `0.04em`
    /// letter-spacing DESIGN.md §3's typography rules specify for uppercase
    /// labels (e.g. ALL-CAPS section headers). Pair with
    /// `.textCase(.uppercase)` at the call site — this does not
    /// force-uppercase the text itself.
    ///
    /// Note: DESIGN.md §4's Stat Cards spec gives a *different* uppercase
    /// letter-spacing (0.05em) for the stat-card metric label specifically —
    /// that is a separate, more specific value this style does not cover.
    /// Not resolved here; flagging the discrepancy for a future style if
    /// stat-card metric labels get built.
    public static let sectionHeaderLabel = NuatisTextStyle(
        font: epilogue(size: 12, weight: .medium, relativeTo: .caption),
        lineSpacing: (1.4 - 1) * 12,
        kerning: 12 * 0.04
    )

    /// Stat number (large), JetBrains Mono — 32px/600/1.1. DESIGN.md §4's
    /// Stat Cards spec ("Stat value: JetBrains Mono 600 32px --ink") is more
    /// specific than §3's general 28–36px/600–700 range and is canon here.
    public static let statNumberLarge = NuatisTextStyle(
        font: jetBrainsMono(size: 32, weight: .semibold, relativeTo: .largeTitle),
        lineSpacing: (1.1 - 1) * 32,
        kerning: 0
    )

    /// Phone / ID / code, JetBrains Mono — 13px/400/1.4. `relativeTo:` is judgment, not canon.
    public static let phoneIdCode = NuatisTextStyle(
        font: jetBrainsMono(size: 13, weight: .regular, relativeTo: .footnote),
        lineSpacing: (1.4 - 1) * 13,
        kerning: 0
    )
}
