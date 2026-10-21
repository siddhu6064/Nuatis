import SwiftUI

/// Design tokens from DESIGN.md §2 (Color Palette & Roles) and §4 (badge
/// border hexes). Every hex value here traces to a line in that file — never
/// a value from apps/mobile/lib/colors.ts, which was built against a
/// different palette.
public enum NuatisColor {

    // MARK: - Core tokens (DESIGN.md §2, "Core Tokens")

    /// Primary action — buttons, links, focus rings, active states, selected nav.
    /// Use for every primary CTA.
    public static let teal = Color(red: 0x00 / 255, green: 0x7A / 255, blue: 0x6E / 255) // #007A6E

    /// Secondary accent — email channel, info badges, external links.
    /// NEVER a primary action — that's `teal`.
    public static let blue = Color(red: 0x00 / 255, green: 0x47 / 255, blue: 0xFF / 255) // #0047FF

    /// App background — all page roots, sidebar bg.
    public static let bg = Color(red: 0xF8 / 255, green: 0xF7 / 255, blue: 0xF4 / 255) // #F8F7F4

    /// Card/surface background. DESIGN.md notes "slight warm offset" from pure
    /// white but gives no distinct hex — using the literal value given.
    public static let paper = Color(red: 0xFF / 255, green: 0xFF / 255, blue: 0xFF / 255) // #FFFFFF

    /// Pure white — used sparingly for contrast on dark surfaces.
    public static let white = Color(red: 0xFF / 255, green: 0xFF / 255, blue: 0xFF / 255) // #FFFFFF

    /// Primary text — headings, labels, table cell primary.
    public static let ink = Color(red: 0x0E / 255, green: 0x0E / 255, blue: 0x0E / 255) // #0E0E0E

    /// Secondary text — sub-labels, descriptions.
    public static let ink2 = Color(red: 0x3A / 255, green: 0x3A / 255, blue: 0x3A / 255) // #3A3A3A

    /// Tertiary text — placeholders, metadata, timestamps.
    public static let ink3 = Color(red: 0x6B / 255, green: 0x6B / 255, blue: 0x6B / 255) // #6B6B6B

    /// Muted / disabled text.
    public static let ink4 = Color(red: 0xAD / 255, green: 0xAD / 255, blue: 0xAD / 255) // #ADADAD

    /// Default border — card borders, table dividers, input borders.
    public static let rule = Color(red: 0xE4 / 255, green: 0xE2 / 255, blue: 0xDC / 255) // #E4E2DC

    /// Stronger border — modal edges, section dividers.
    public static let rule2 = Color(red: 0xCC / 255, green: 0xCA / 255, blue: 0xC2 / 255) // #CCCAC2

    /// Success — deal won, payment confirmed, sync active.
    public static let green = Color(red: 0x00 / 255, green: 0x6B / 255, blue: 0x3F / 255) // #006B3F

    /// Warning / amber — overdue, trial expiring, caution. Gold owns warnings —
    /// never use `red` for a warning state.
    public static let gold = Color(red: 0xC0 / 255, green: 0x7D / 255, blue: 0x00 / 255) // #C07D00

    /// Error / destructive — delete confirm, failed payment, form error.
    /// Destructive only.
    public static let red = Color(red: 0xC0 / 255, green: 0x00 / 255, blue: 0x3C / 255) // #C0003C

    /// Alias for `red` (DESIGN.md lists `--rose` as an alias of `--red`).
    public static let rose = red

    /// Maya / voice AI — call active, mic indicator, Maya-branded surfaces.
    /// RESERVED. Never use outside Maya/voice surfaces — using it elsewhere
    /// dilutes the signal (DESIGN.md §7).
    public static let orange = Color(red: 0xE8 / 255, green: 0x4A / 255, blue: 0x00 / 255) // #E84A00

    /// Pipeline stages, social channel, CPQ proposal status.
    public static let purple = Color(red: 0x7C / 255, green: 0x3A / 255, blue: 0xED / 255) // #7C3AED

    // MARK: - Semantic palette extensions (DESIGN.md §2, "Semantic Palette Extensions")

    /// Teal badge background, selected row tint.
    public static let tealPale = Color(red: 0xE0 / 255, green: 0xF4 / 255, blue: 0xF2 / 255) // #E0F4F2

    /// Email channel chip background.
    public static let bluePale = Color(red: 0xEB / 255, green: 0xF0 / 255, blue: 0xFF / 255) // #EBF0FF

    /// Email channel chip border.
    public static let blueMid = Color(red: 0xC2 / 255, green: 0xD0 / 255, blue: 0xFF / 255) // #C2D0FF

    /// Maya card background tint.
    public static let orangePale = Color(red: 0xFF / 255, green: 0xF0 / 255, blue: 0xEB / 255) // #FFF0EB

    /// Warning banner background, DemoBanner background.
    public static let goldPale = Color(red: 0xFF / 255, green: 0xF8 / 255, blue: 0xE6 / 255) // #FFF8E6

    /// Success state backgrounds.
    public static let greenPale = Color(red: 0xE5 / 255, green: 0xF5 / 255, blue: 0xEE / 255) // #E5F5EE

    /// Pipeline stage chips, social channel chip background.
    public static let purplePale = Color(red: 0xED / 255, green: 0xE9 / 255, blue: 0xFE / 255) // #EDE9FE

    /// Error/destructive badge background.
    public static let rosePale = Color(red: 0xFF / 255, green: 0xEB / 255, blue: 0xF3 / 255) // #FFEBF3

    /// DemoBanner border. DESIGN.md marks this "approx" — treat as such if
    /// the brand hex is ever formalized.
    public static let amber200 = Color(red: 0xFC / 255, green: 0xD3 / 255, blue: 0x4D / 255) // #FCD34D (approx)

    // MARK: - Badge borders (DESIGN.md §4, "Badges / Chips / Status Pills" — status mapping table)

    /// Border for active/won/delivered badges (green-pale background).
    public static let greenBorder = Color(red: 0xA3 / 255, green: 0xD9 / 255, blue: 0xBE / 255) // #A3D9BE

    /// Border for pending/trial/queued badges (gold-pale background).
    public static let goldBorder = Color(red: 0xF5 / 255, green: 0xC9 / 255, blue: 0x7A / 255) // #F5C97A

    /// Border for failed/error/lost badges (rose-pale background).
    public static let roseBorder = Color(red: 0xF5 / 255, green: 0xA3 / 255, blue: 0xBC / 255) // #F5A3BC

    /// Border for running/live badges (orange-pale background). Maya/voice
    /// surfaces only — same reservation as `orange` itself.
    public static let orangeBorder = Color(red: 0xFF / 255, green: 0xB8 / 255, blue: 0x99 / 255) // #FFB899
}
