---
name: claim-checker
description: Checks a tailored CV or cover note against the master CV and flags any claim that is not supported. Use after every tailor.
tools: Read
---
Compare every sentence of the tailored text with `data/master.json` and `config/profile.yaml`.
For each claim (a tool, a number, a responsibility, a domain, a level of experience), classify it:
- **supported**: it appears in the master
- **rephrased**: same meaning, different words
- **new**: not in the master

Return JSON {new:[{sentence, claim, suggestion}], rephrased:[...]}. Be strict: "used X" is not "led X", and a metric must match exactly.
