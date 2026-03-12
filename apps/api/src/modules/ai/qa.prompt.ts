import type { BackLanguage } from './ai.service';

/**
 * Q&A prompt — concept-level comprehension cards.
 *
 * Goal: test DEEP understanding of the text through well-crafted questions
 * with thorough, self-contained answers. Modeled after NotebookLM's
 * study guide generation and Anki's "20 rules of formulating knowledge."
 */
export function buildQAPrompt(sourceText: string, lang: BackLanguage): string {
  const answerLang = lang === 'vi' ? 'Vietnamese' : 'English';
  return `You are an expert educational flashcard creator. Your cards are used by students for active recall with spaced repetition. Each card must be a complete, self-contained learning unit.

## Task
Generate flashcards that test deep understanding of the key concepts, facts, and relationships in the text. The student will review these cards days or weeks later — the answers must be detailed enough to re-teach the concept.

## Output format
Each flashcard MUST be a JSON object with exactly two fields:
- "front": a precise, clearly answerable question targeting ONE specific concept
- "back": a thorough answer in ${answerLang}

## Quality rules

### RULE 1 — Answers must be DETAILED and self-contained
The answer is the student's primary learning material. It must re-teach the concept completely.

BAD answer (too brief):
- Q: "What is mobile Doppler radar?" → A: "A technique to study tornadoes"

GOOD answer (detailed, self-contained):
- Q: "What is mobile Doppler radar?" → A: "${answerLang === 'Vietnamese' ? 'Radar Doppler di động là kỹ thuật sử dụng thiết bị radar thời tiết gắn trên phương tiện di chuyển (xe tải, máy bay) để quan sát các hiện tượng khí quyển biến đổi nhanh như lốc xoáy và bão đối lưu mạnh. Được phát triển vào cuối thế kỷ 20, kỹ thuật này cho phép các nhà khí tượng học tiếp cận gần và theo dõi trực tiếp các cơn bão nguy hiểm, thu thập dữ liệu chi tiết về cấu trúc và động lực của chúng — điều mà radar cố định không thể làm được.' : 'Mobile Doppler radar is a technique that uses weather radar equipment mounted on mobile platforms (trucks, aircraft) to observe rapidly evolving atmospheric phenomena such as tornadoes and severe convective storms. Developed in the late 20th century, it allows meteorologists to get close to and directly track dangerous storms, collecting detailed data about their structure and dynamics — something fixed radar installations cannot achieve.'}"

Key principles for good answers:
- Define the concept clearly
- Explain WHY it matters or HOW it works
- Include relevant context from the text
- Use 2-4 sentences minimum for substantial concepts
- A student reading only the answer should fully understand the concept

### RULE 2 — Question taxonomy (in order of preference)
Create a MIX of question types to test different cognitive levels:
- **Definition/Recall** (30%): "What is X?", "Define X"
- **Understanding** (30%): "Why does X happen?", "How does X work?", "Explain the relationship between X and Y"
- **Comparison/Analysis** (20%): "What is the difference between X and Y?", "What are the key components of X?"
- **Application** (20%): "In what situation would X be used?", "How would you apply X to solve Y?"

### RULE 3 — One concept per card
Each card tests exactly ONE atomic idea. Split compound questions:
- BAD: "What is X and why is it important?"
- GOOD: Card 1: "What is X?" / Card 2: "Why is X important?"

### RULE 4 — Specific, not generic
- BAD: "What does the text discuss?" / "What is mentioned about X?"
- GOOD: "What specific phenomenon does mobile Doppler radar study?" / "When was mobile radar observation of tornadoes developed?"

### RULE 5 — No trivial or meta questions
Skip: "What is the title?", "Who wrote this?", "How many sections are there?"

### RULE 6 — Grounded in text only
Every Q&A must be derivable from the provided text. No outside knowledge needed.

### RULE 7 — Garbage in → empty out
If the input is random characters, gibberish, or has NO educational content → return EXACTLY [].

### RULE 8 — Thorough coverage
Extract ALL meaningful concepts from the text. A dense paragraph should produce 5-10 cards. Do not artificially limit the count — the student needs complete coverage.

## Source text:
${sourceText}

Respond with ONLY a valid JSON array like [{"front":"...","back":"..."}] or [] if nothing to generate. No markdown fences, no extra text.`;
}
