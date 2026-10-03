import type { EditorialIntent, ScriptBeat } from '../types/editor'

interface ParsedBeatTemplate {
  intent: EditorialIntent
  visualRole: string
  visualDescription: string
  retrievalQuery: string
}

const NARRATIVE_PROGRESSION: EditorialIntent[] = [
  'intro',
  'context',
  'problem',
  'escalation',
  'solution',
  'effect',
  'conclusion',
]

/**
 * Break an arbitrary script into editorial beats with intent, visual role, description, and search query.
 */
export function analyzeScriptToBeats(scriptText: string): ScriptBeat[] {
  const paragraphs = scriptText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  // If user entered single line or wall of text, split by sentences
  let segments: string[] = []
  if (paragraphs.length === 1 && paragraphs[0].length > 120) {
    const sentences = paragraphs[0]
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10)
    segments = sentences.length > 1 ? sentences : paragraphs
  } else {
    segments = paragraphs
  }

  if (segments.length === 0) {
    return []
  }

  return segments.map((text, index) => {
    const beatNumber = index + 1
    const template = inferBeatMetadata(text, index, segments.length)
    const wordCount = text.split(/\s+/).length
    // Average narration pace is ~2.5 words per second
    const targetDuration = Math.max(4.0, Math.min(12.0, Math.round((wordCount / 2.3) * 10) / 10))

    return {
      id: `beat-${beatNumber}-${Date.now().toString(36)}`,
      beat_number: beatNumber,
      narration: text,
      editorial_intent: template.intent,
      visual_role: template.visualRole,
      visual_description: template.visualDescription,
      retrieval_query: template.retrievalQuery,
      assigned_clip: null,
      target_duration: targetDuration,
      status: 'analyzed',
    }
  })
}

function inferBeatMetadata(text: string, index: number, total: number): ParsedBeatTemplate {
  const lower = text.toLowerCase()

  // 1. Determine editorial intent based on position and key terms
  let intent: EditorialIntent = 'context'
  if (index === 0) {
    intent = 'intro'
  } else if (index === total - 1) {
    intent = 'conclusion'
  } else if (lower.match(/however|problem|barrier|crisis|danger|fail|struggle|limit|bottleneck|risk|loss/)) {
    intent = 'problem'
  } else if (lower.match(/lead|escalat|grow|strain|increas|sever|threat|consequen/)) {
    intent = 'escalation'
  } else if (lower.match(/solve|engineer|build|solution|transform|innovat|breakthrough|develop|creat/)) {
    intent = 'solution'
  } else if (lower.match(/result|impact|future|promis|allow|enabl|deliver|transform/)) {
    intent = 'effect'
  } else {
    // Map evenly across standard dramatic narrative arc
    const arcIndex = Math.min(NARRATIVE_PROGRESSION.length - 1, Math.floor((index / total) * NARRATIVE_PROGRESSION.length))
    intent = NARRATIVE_PROGRESSION[arcIndex]
  }

  // 2. Extract key visual concepts
  const tokens = lower
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)

  // Identify topical cluster
  let visualRole = `Illustrate narrative beat ${index + 1} with supporting B-roll footage.`
  let visualDescription = `Cinematic high-definition B-roll footage conveying ${text.slice(0, 50)}...`
  let retrievalQuery = tokens.slice(0, 6).join(' ')

  if (lower.match(/charg|electr|ev\b|car|vehicle|automob|battery/)) {
    visualRole = 'Depict electric vehicle charging infrastructure, battery tech, or highway transit.'
    visualDescription = 'Electric car at roadside charging terminal, power cable connection, and urban mobility.'
    retrievalQuery = 'electric vehicle charging station ev battery car'
  } else if (lower.match(/traffic|road|city|transit|highway|commut/)) {
    visualRole = 'Show metropolitan traffic density, urban road network, and street motion.'
    visualDescription = 'Dense city streets with vehicles, evening illumination, and transit flow.'
    retrievalQuery = 'city traffic streets road transportation cars urban'
  } else if (lower.match(/doctor|medic|health|patient|hospital|clinic|diagnos/)) {
    visualRole = 'Highlight clinical medical consultation, diagnosis, and healthcare staff.'
    visualDescription = 'Medical doctor in consultation, examining diagnostic radiography in clinical ward.'
    retrievalQuery = 'doctor hospital medicine patient medical examination clinic'
  } else if (lower.match(/ai\b|intellig|comput|circuit|chip|brain|robot/)) {
    visualRole = 'Visualise artificial intelligence, digital computing hardware, and microchip processing.'
    visualDescription = 'Motherboard microprocessor circuits with digital glowing signals.'
    retrievalQuery = 'brain circuit artificial intelligence electronics board microchip'
  } else if (lower.match(/meet|office|work|team|collaborat|plan|execut/)) {
    visualRole = 'Illustrate strategic business collaboration, teamwork, and planning.'
    visualDescription = 'Corporate colleagues gathered in modern meeting conference room reviewing materials.'
    retrievalQuery = 'meeting planning business team people office conference'
  } else if (lower.match(/market|financ|stock|trade|invest|econom/)) {
    visualRole = 'Convey dynamic financial stock exchange metrics, charts, and trading data.'
    visualDescription = 'Financial charts with fluctuating market candlesticks and analytical graphics.'
    retrievalQuery = 'stock market financial exchange graph profits analysis'
  } else if (lower.match(/science|scientist|lab|research|molecul/)) {
    visualRole = 'Show dedicated laboratory scientist conducting empirical scientific research.'
    visualDescription = 'Laboratory scientist using sterile research instruments and laboratory microscope.'
    retrievalQuery = 'scientist laboratory research science technology lab'
  } else if (lower.match(/flight|plane|airport|avia|airlin/)) {
    visualRole = 'Capture modern aviation, passenger airport operations, and high-altitude flight.'
    visualDescription = 'Airliner aircraft on airport tarmac preparing for departure flight.'
    retrievalQuery = 'airport airplane plane flight aircraft transportation'
  } else if (lower.match(/ocean|wave|sea|coast|water|beac/)) {
    visualRole = 'Evoke open natural expanse with ocean waves crashing against coast.'
    visualDescription = 'Powerful coastal waves breaking across sea shore at sunrise.'
    retrievalQuery = 'ocean wave sea coast water surf landscape'
  } else if (lower.match(/mountain|natur|forest|snow|peak/)) {
    visualRole = 'Establish majestic mountain topography, cloud cover, and pristine alpine wilderness.'
    visualDescription = 'Panoramic mountain peak covered in snow with passing weather fronts.'
    retrievalQuery = 'mountain snow nature landscape clouds travel'
  } else if (lower.match(/factor|industr|steel|weld|product/)) {
    visualRole = 'Show heavy industrial manufacturing, welding sparks, and factory production.'
    visualDescription = 'Industrial metal production facility with welding sparks and heavy machinery.'
    retrievalQuery = 'industry factory production welder steel workshop'
  } else if (lower.match(/typ|code|keyboard|softwar|screen/)) {
    visualRole = 'Show close-up keyboard typing, software development, and digital writing.'
    visualDescription = 'Hands typing with precision across backlit laptop keyboard.'
    retrievalQuery = 'keyboard typing writing laptop computer technology'
  } else if (lower.match(/fit|gym|workout|train|exercis/)) {
    visualRole = 'Depict intense athletic training, gym workout discipline, and physical exertion.'
    visualDescription = 'Athlete performing training exercise routine inside gym.'
    retrievalQuery = 'workout fitness gym training exercise health'
  }

  return {
    intent,
    visualRole,
    visualDescription,
    retrievalQuery,
  }
}
