Circuit Tutor (GCSE)
====================

A Socratic AI tutor for GCSE electronic circuits (ages 14-16), part of the
Genesis suite of K-12 educational tools.

WHAT IT DOES
------------
Students build and investigate circuits in an interactive simulator. An AI
tutor ("Professor Volt") guides them through GCSE-level concepts using short
Socratic questions rather than giving answers away. Responses are grounded in
a curated physics knowledge base to prevent hallucinated formulas.

Topics covered:
  - Ohm's law (V = IR)
  - Series and parallel circuits
  - Ammeter and voltmeter placement
  - Fault-finding (open circuits, short circuits)
  - Open-ended circuit exploration

STRUCTURE
---------
  frontend/
    index.html               - Main app (self-contained)
    src/
      data/
        tasks.json            - Ordered task list (edit to add/remove tasks)
        knowledgeBase.js      - Curated GCSE KB + pinned safeguarding (client retrieval)
      sim/physics.js          - Client-side physics simulation
      tasks/engine.js         - Task card renderer
      tutor/api.js            - Tutor HTTP client (posts to /api/tutor)
      circuit/ state/ ui/     - Editor, renderer, state store, panels
    api/
      tutor.py                - Vercel serverless function (AI tutor endpoint)
      circuit_validator.py    - Server-side circuit analysis (grounding)
      knowledge_base.json     - KB loaded by tutor.py; mirrors knowledgeBase.js
    vercel.json              - Vercel deployment config
    requirements.txt         - Python dependencies for serverless functions

DEPLOYMENT
----------
The frontend deploys to Vercel as a zero-install browser app. No local
environment is required to use it - students open the URL and start learning.

To run locally for development:
  npx serve frontend/

AI SAFETY
---------
Professor Volt is constrained to the circuits domain only. Out-of-scope
requests are refused with a fixed message. All physics claims are fact-checked
against the curated knowledge base before being shown to students.

Part of the Genesis project: zero-install, AI-powered K-12 maths and physics
tools designed for classroom use.
