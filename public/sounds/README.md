# Custom sounds

Drop audio files here to replace the built-in synthesised effects:

| File | Played when |
| --- | --- |
| `card.mp3` | a card or combo lands on the table |
| `chop.mp3` | a bomb chops another play |
| `catch.mp3` | the catch-the-2 reveal |
| `penalty.mp3` | someone is caught stuck on a full hand |

Any format the browser can play works (`.mp3`, `.ogg`, `.wav`). Keep them short
(under a second) and small (~100KB) so they start instantly.

A missing file falls back to the synthesised sound, so you can add one, both or
neither. No code change or rebuild is needed — the app checks for the file at
runtime and caches the answer.
