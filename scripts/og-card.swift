// Renders the social card with CoreText, which does Arabic bidi and shaping
// correctly. Satori (what next/og uses) shapes the letters but reverses the
// words on any wrapped line and puts trailing punctuation on the wrong side.
import AppKit
import CoreText
import Foundation

let W = 1200.0, H = 630.0
let out = URL(fileURLWithPath: CommandLine.arguments[1])
let tagline = CommandLine.arguments[2]
let blurb = CommandLine.arguments[3]
let siteName = CommandLine.arguments[4]

let cs = CGColorSpaceCreateDeviceRGB()
guard let ctx = CGContext(data: nil, width: Int(W), height: Int(H), bitsPerComponent: 8,
                          bytesPerRow: 0, space: cs,
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
    print("no context"); exit(1)
}

// Brand gradient, the same two stops the site's own .bg-brand-gradient uses.
let gradient = CGGradient(colorsSpace: cs, colors: [
    CGColor(red: 0.102, green: 0.247, blue: 0.831, alpha: 1),
    CGColor(red: 0.043, green: 0.561, blue: 0.769, alpha: 1),
] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: H), end: CGPoint(x: W, y: 0), options: [])

// One soft highlight in the top corner, matching the hero's bloom.
let bloom = CGGradient(colorsSpace: cs, colors: [
    CGColor(red: 1, green: 1, blue: 1, alpha: 0.20),
    CGColor(red: 1, green: 1, blue: 1, alpha: 0),
] as CFArray, locations: [0, 1])!
ctx.drawRadialGradient(bloom, startCenter: CGPoint(x: W - 180, y: H - 40), startRadius: 0,
                       endCenter: CGPoint(x: W - 180, y: H - 40), endRadius: 620, options: [])

func font(_ size: CGFloat, _ weight: NSFont.Weight) -> CTFont {
    let base = NSFont.systemFont(ofSize: size, weight: weight)
    // Ask for a face that actually has Arabic; the cascade fills any gaps.
    let desc = base.fontDescriptor.addingAttributes([
        .cascadeList: [NSFontDescriptor(name: "GeezaPro", size: size)],
    ])
    return CTFontCreateWithFontDescriptor(desc as CTFontDescriptor, size, nil)
}

/// Draws a block whose TOP edge sits at `top`, and returns the height it used.
/// CoreText fills a frame downward from the top of its rect, so laying out from
/// a measured height is the only way to stack blocks without guessing at gaps.
func draw(_ text: String, size: CGFloat, weight: NSFont.Weight, alpha: CGFloat,
          top: CGFloat, width: CGFloat, lineHeight: CGFloat,
          rightInset: CGFloat = 0) -> CGFloat {
    // Every block shares one right edge, so a narrower one is inset on its
    // left. Shrinking the rect from the right instead staggers the margin,
    // which reads as a mistake rather than as a hierarchy.
    let left = W - margin - rightInset - width
    let style = NSMutableParagraphStyle()
    style.alignment = .right
    // The one line that makes this correct: the paragraph runs right to left,
    // so wrapped lines keep their word order and neutrals sit on the right side.
    style.baseWritingDirection = .rightToLeft
    style.lineHeightMultiple = lineHeight
    style.lineBreakMode = .byWordWrapping

    let attributed = NSAttributedString(string: text, attributes: [
        .font: font(size, weight) as Any,
        .foregroundColor: NSColor(white: 1, alpha: alpha),
        .paragraphStyle: style,
    ])

    let setter = CTFramesetterCreateWithAttributedString(attributed)
    let fitted = CTFramesetterSuggestFrameSizeWithConstraints(
        setter, CFRangeMake(0, 0), nil,
        CGSize(width: width, height: .greatestFiniteMagnitude), nil)
    let height = ceil(fitted.height)

    let rect = CGRect(x: left, y: top - height, width: width, height: height)
    let frame = CTFramesetterCreateFrame(setter, CFRangeMake(0, 0), CGPath(rect: rect, transform: nil), nil)
    CTFrameDraw(frame, ctx)
    return height
}

let margin = 76.0
let contentWidth = W - margin * 2

// Laid out from the footer upward, so a two-line tagline pushes the blurb up
// rather than overlapping the mark.
let footerTop = 118.0
let blurbTop = 286.0
let blurbHeight = draw(blurb, size: 31, weight: .medium, alpha: 0.88,
                       top: blurbTop, width: contentWidth - 60, lineHeight: 1.5)
_ = draw(tagline, size: 64, weight: .bold, alpha: 1,
         top: blurbTop + blurbHeight + 46, width: contentWidth, lineHeight: 1.3)

// The mark: a rounded square, the same shape the site's rail uses.
let mark = CGRect(x: W - margin - 48, y: footerTop - 48, width: 48, height: 48)
ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.22))
ctx.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.55))
ctx.setLineWidth(2)
let rounded = CGPath(roundedRect: mark, cornerWidth: 14, cornerHeight: 14, transform: nil)
ctx.addPath(rounded); ctx.fillPath()
ctx.addPath(rounded); ctx.strokePath()

// Inset past the mark, which sits on the right where an RTL reader starts.
_ = draw(siteName, size: 33, weight: .bold, alpha: 0.95,
         top: footerTop - 9, width: contentWidth - 70, lineHeight: 1.0, rightInset: 66)

guard let image = ctx.makeImage() else { print("no image"); exit(1) }
let rep = NSBitmapImageRep(cgImage: image)
guard let png = rep.representation(using: .png, properties: [:]) else { print("no png"); exit(1) }
try png.write(to: out)
print("wrote \(out.path)")
