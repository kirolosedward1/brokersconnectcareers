// The words on a screenshot, read by macOS's text recognition, top to bottom.
//
//     swift scripts/screen-text.swift <screenshot.png>
//
// Used by scripts/store-screens.sh when a pass fails: it says what the screen
// showed even when the test driver could read nothing of it.
import AppKit
import Vision

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

guard CommandLine.arguments.count > 1,
      let image = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let picture = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
else { fail("no image") }

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
let supported = (try? request.supportedRecognitionLanguages()) ?? []
let languages = ["ar-SA", "en-US"].filter(supported.contains)
if !languages.contains("ar-SA") { print("(this Mac does not read Arabic: only Latin text below)") }
request.recognitionLanguages = languages

do {
    try VNImageRequestHandler(cgImage: picture).perform([request])
} catch {
    fail("\(error)")
}
// Vision's boxes start at the bottom left.
for line in (request.results ?? []).sorted(by: { $0.boundingBox.maxY > $1.boundingBox.maxY }) {
    if let text = line.topCandidates(1).first?.string { print(text) }
}
