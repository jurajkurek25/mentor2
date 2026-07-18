// Rozdelí text na kúsky ~500 slov s malým prekrytím, aby sa neroztrhli myšlienky na hranici.
function chunkText(text, wordsPerChunk = 500, overlapWords = 50) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + wordsPerChunk, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end === words.length) break;
    start = end - overlapWords;
  }

  return chunks;
}

module.exports = { chunkText };
