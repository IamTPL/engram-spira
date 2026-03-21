workspace "Engram Spira" "C4 Architecture — All Levels" {

  model {
    student = person "Student" "A learner who creates and reviews flashcard decks using spaced repetition, AI-generated cards, and knowledge graph visualization."

    geminiApi     = softwareSystem "Google Gemini API"     "LLM and embedding endpoint used for AI card generation, concept extraction, and vector embedding (768d)."
    gmailSmtp     = softwareSystem "Gmail SMTP"            "Google SMTP relay used for transactional emails (verification, password reset, feedback)."

    engramSpira = softwareSystem "Engram Spira" "AI-powered spaced-repetition flashcard web app with dual SRS (SM-2 + FSRS), Knowledge Graph, semantic search, and study analytics." {

      webSpa = container "Web SPA" "SolidJS single-page application. Fine-grained reactive UI with TanStack Query for server-state caching and Eden Treaty for type-safe API calls." "SolidJS · TailwindCSS v4 · Vite · Bun" {

        router           = component "Router"                  "Declares all routes; wraps protected pages in ProtectedRoute / GuestRoute guards."                    "@solidjs/router"
        authStore        = component "Auth Store"              "Reactive signal for currentUser; calls GET /auth/me on mount; exposes login/logout."                  "SolidJS signal"
        edenClient       = component "Eden API Client"         "treaty<App>() — end-to-end type-safe HTTP client; sends session cookie on every request."             "Elysia Eden Treaty"
        queryClient      = component "Query Client"            "TanStack Query cache; provides createQuery / createMutation; invalidates on mutations."               "TanStack Solid Query"

        dashPage            = component "Dashboard Page"            "Shows classes, folders, decks; due-card notifications; forecast widget; smart group widget."                   "SolidJS page"
        folderPage          = component "Folder View Page"          "Lists and manages decks within a selected folder."                                                             "SolidJS page"
        deckPage            = component "Deck View Page"            "Card list with inline CRUD; AI generation modal; CSV import/export; Knowledge Graph panel; duplicate detection." "SolidJS page"
        studyPage           = component "Study Mode Page"           "Flipcard UI; SM-2/FSRS review actions (again/hard/good/easy); keyboard shortcuts; progress bar."                "SolidJS page"
        interleavedPage     = component "Interleaved Study Page"    "Cross-deck due-card sessions; manual deck selection or auto top-N by due count."                                "SolidJS page"
        analyticsPage       = component "Analytics Page"            "Retention heatmap, at-risk cards, prerequisite chains, forecast chart."                                         "SolidJS page"
        searchPage          = component "Global Search Page"        "Semantic + text search across all user cards with result enrichment."                                            "SolidJS page"
        knowledgeGraphPage  = component "Knowledge Graph View"      "Cytoscape.js interactive graph; node retention overlay; AI relationship suggestions."                           "Cytoscape.js"
        settingsPage        = component "Settings Page"             "User profile editing; SRS algorithm selector (SM-2/FSRS); theme toggle; password change."                       "SolidJS page"
        feedbackPage        = component "Feedback Page"             "Submits user feedback and bug reports to the API."                                                               "SolidJS page"
        resetPasswordPage   = component "Reset Password Page"       "Public page for completing the password reset token flow."                                                       "SolidJS page"
        docsPage            = component "Docs Page"                 "Renders SRS document, C4 diagrams (SVG), and ERD from public/docs/."                                             "SolidJS page"

        focusDrawer  = component "Focus Drawer"      "Floating Pomodoro-style timer with ambient sounds (Web Audio API), 3D dice rewards (Three.js), daily focus stats."  "SolidJS component"
        toaster      = component "Toaster"           "Global toast notification overlay."                                                                                "SolidJS component"
        themeStore   = component "Theme Store"       "Dark/light/system mode toggle; persisted to localStorage."                                                          "SolidJS signal"
      }

      apiServer = container "API Server" "ElysiaJS REST API on Bun. 15 feature modules with session-based auth, dual SRS engines (SM-2 + FSRS), AI card generation, embedding pipeline, Knowledge Graph, and semantic search." "ElysiaJS · Bun · Drizzle ORM" {

        authModule         = component "Auth Module"                "Register, login, logout, GET /auth/me. Hashes passwords with argon2; session tokens via oslo/crypto CSPRNG; email verification; password reset." "ElysiaJS Route"
        authMiddleware     = component "Auth Middleware"             "Reads session cookie, validates token against DB, injects currentUser into request context."         "ElysiaJS Plugin"
        classesModule      = component "Classes Module"             "CRUD — top-level academic subjects owned by a user."                                                 "ElysiaJS Route"
        foldersModule      = component "Folders Module"             "CRUD — chapters/folders nested inside a class."                                                      "ElysiaJS Route"
        decksModule        = component "Decks Module"               "CRUD — flashcard sets nested inside a folder. Deck-level card count and due count."                  "ElysiaJS Route"
        cardTplModule      = component "Card Templates Module"      "Manages reusable field schemas (Vocabulary, Q&A, Custom). EAV pattern for card_field_values."        "ElysiaJS Route"
        cardsModule        = component "Cards Module"               "CRUD — individual cards with field values keyed to a template. Drag-and-drop reorder."               "ElysiaJS Route"
        studyModule        = component "Study / SRS Engine"         "Dual algorithm: SM-2 (ease factor + interval) and FSRS (stability + difficulty via ts-fsrs). Due cards, review dispatch, stats, interleaved study, forecast, retention heatmap, at-risk detection, smart groups, prerequisite chains." "ElysiaJS Route"
        aiModule           = component "AI Card Generator Module"   "POST /ai/generate — Gemini streaming card generation (vocabulary + Q&A modes). Background job system with orphan recovery and 24h cleanup." "ElysiaJS Route"
        embeddingModule    = component "Embedding Module"           "Generates 768d vectors via Gemini Embedding API. Batch embed, backfill, pgvector storage. Cosine similarity search." "ElysiaJS Route"
        searchModule       = component "Search Module"              "Semantic search (embedding cosine) with text fallback (ILIKE). Result enrichment with card fields and deck names." "ElysiaJS Route"
        kgModule           = component "Knowledge Graph Module"     "Card link CRUD (prerequisite/related). AI relationship detection via embedding pairwise cosine. Concept extraction. Graph data for Cytoscape.js." "ElysiaJS Route"
        dupModule          = component "Duplicate Detection"        "Detects duplicate cards via embedding cosine similarity (85% threshold). Per-card check and full-deck scan." "ElysiaJS Service"
        notifModule        = component "Notifications Module"       "GET /notifications/due-decks, /due-count. Returns decks and total count of due cards."              "ElysiaJS Route"
        feedbackModule     = component "Feedback Module"            "POST /feedback. Collects bug reports; sends email via Gmail SMTP (fire-and-forget Nodemailer)."      "ElysiaJS Route"
        usersModule        = component "Users Module"               "PATCH /users/profile (displayName, avatarUrl); GET /users/avatars."                                 "ElysiaJS Route"
        importExportModule = component "Import/Export Module"       "POST /import/csv (CSV parser with quoted field handling); GET /export (CSV/JSON). Rate-limited."     "ElysiaJS Route"
        dbClient           = component "Drizzle DB Client"          "Singleton ORM client; typed SQL queries against PostgreSQL. 16 table schemas with relations."        "Drizzle ORM"
      }

      database = container "PostgreSQL Database" "Stores all data: users, sessions, classes, folders, decks, cards (EAV), card templates, study progress (SM-2 + FSRS), review logs, daily logs, card links, card concepts, AI jobs, FSRS params, password reset tokens. pgvector extension for 768d embedding vectors." "PostgreSQL 15 · pgvector · Docker"
    }

    // ── Level 1: Context relationships
    student -> engramSpira "Creates flashcards, studies with SRS, explores Knowledge Graph, uses AI generation" "HTTPS"
    engramSpira -> geminiApi     "Generates AI flashcards, extracts concepts, creates 768d embeddings" "HTTPS/REST"
    engramSpira -> gmailSmtp     "Sends verification emails, password reset, feedback notifications"    "SMTP (TLS)"

    // ── Level 2: Container relationships
    student   -> webSpa    "Interacts via browser"                          "HTTPS"
    webSpa    -> apiServer "REST API calls with session cookie"             "HTTP JSON / Eden Treaty"
    apiServer -> database  "Queries and mutations via Drizzle ORM"         "TCP / SQL"

    // ── Level 3a: API Server component relationships
    authModule         -> dbClient       "Reads/writes users & sessions"                                "Drizzle ORM"
    authMiddleware     -> dbClient       "Validates session token"                                      "Drizzle ORM"
    classesModule      -> authMiddleware "Protected by"
    classesModule      -> dbClient       "Queries classes"                                              "Drizzle ORM"
    foldersModule      -> authMiddleware "Protected by"
    foldersModule      -> dbClient       "Queries folders"                                              "Drizzle ORM"
    decksModule        -> authMiddleware "Protected by"
    decksModule        -> dbClient       "Queries decks"                                                "Drizzle ORM"
    cardTplModule      -> authMiddleware "Protected by"
    cardTplModule      -> dbClient       "Queries card_templates, template_fields"                      "Drizzle ORM"
    cardsModule        -> authMiddleware "Protected by"
    cardsModule        -> dbClient       "Queries cards, card_field_values"                             "Drizzle ORM"
    studyModule        -> authMiddleware "Protected by"
    studyModule        -> dbClient       "Reads/writes study_progress, review_logs, study_daily_logs"   "Drizzle ORM"
    aiModule           -> authMiddleware "Protected by"
    aiModule           -> dbClient       "Reads/writes ai_generation_jobs, cards"                       "Drizzle ORM"
    aiModule           -> geminiApi      "Sends structured prompt; parses streaming card response"      "HTTPS/REST"
    embeddingModule    -> authMiddleware "Protected by"
    embeddingModule    -> dbClient       "Writes embedding vectors to card_field_values"                "Drizzle ORM / raw SQL"
    embeddingModule    -> geminiApi      "Generates 768d embedding vectors"                             "HTTPS/REST"
    searchModule       -> authMiddleware "Protected by"
    searchModule       -> dbClient       "pgvector cosine distance query + ILIKE fallback"              "Drizzle ORM / raw SQL"
    kgModule           -> authMiddleware "Protected by"
    kgModule           -> dbClient       "Reads/writes card_links, card_concepts"                       "Drizzle ORM"
    kgModule           -> embeddingModule "Uses embedding similarity for AI relationship detection"
    dupModule          -> dbClient       "pgvector cosine similarity for duplicate detection"           "Drizzle ORM / raw SQL"
    notifModule        -> authMiddleware "Protected by"
    notifModule        -> dbClient       "Queries due decks"                                            "Drizzle ORM"
    feedbackModule     -> authMiddleware "Protected by"
    feedbackModule     -> gmailSmtp      "Sends feedback email (fire-and-forget Nodemailer)"            "SMTP"
    usersModule        -> authMiddleware "Protected by"
    usersModule        -> dbClient       "Reads/writes user profile"                                    "Drizzle ORM"
    importExportModule -> authMiddleware "Protected by"
    importExportModule -> dbClient       "Reads/writes cards, card_field_values, decks"                 "Drizzle ORM"
    dbClient           -> database       "TCP SQL"                                                      "TCP / SQL"

    // ── Level 3b: SPA component relationships
    router      -> dashPage              "Renders at /"                     "SolidJS Router"
    router      -> folderPage            "Renders at /folder/:id"           "SolidJS Router"
    router      -> deckPage              "Renders at /deck/:id"             "SolidJS Router"
    router      -> studyPage             "Renders at /study/:deckId"        "SolidJS Router"
    router      -> interleavedPage       "Renders at /study/interleaved"    "SolidJS Router"
    router      -> analyticsPage         "Renders at /analytics"            "SolidJS Router"
    router      -> searchPage            "Renders at /search"               "SolidJS Router"
    router      -> settingsPage          "Renders at /settings"             "SolidJS Router"
    router      -> feedbackPage          "Renders at /feedback"             "SolidJS Router"
    router      -> resetPasswordPage     "Renders at /reset-password"       "SolidJS Router"
    router      -> docsPage              "Renders at /docs"                 "SolidJS Router"
    router      -> authStore             "Reads currentUser signal"         "SolidJS signal"
    dashPage            -> queryClient   "createQuery / createMutation"     "TanStack Query"
    folderPage          -> queryClient   "createQuery / createMutation"     "TanStack Query"
    deckPage            -> queryClient   "createQuery / createMutation"     "TanStack Query"
    studyPage           -> queryClient   "createQuery / createMutation"     "TanStack Query"
    interleavedPage     -> queryClient   "createQuery / createMutation"     "TanStack Query"
    analyticsPage       -> queryClient   "createQuery"                      "TanStack Query"
    searchPage          -> queryClient   "createQuery"                      "TanStack Query"
    knowledgeGraphPage  -> queryClient   "createQuery / createMutation"     "TanStack Query"
    settingsPage        -> queryClient   "createMutation"                   "TanStack Query"
    feedbackPage        -> queryClient   "createMutation"                   "TanStack Query"
    queryClient  -> edenClient  "Calls API functions"               "Eden Treaty"
    authStore    -> edenClient  "Calls /auth/me, login, logout"     "Eden Treaty"
    edenClient   -> apiServer   "HTTP JSON + cookie"                "HTTP"
  }

  views {

    // Level 1 — System Context
    systemContext engramSpira "Context" {
      include *
      autolayout lr
    }

    // Level 2 — Containers
    container engramSpira "Containers" {
      include *
      autolayout lr
    }

    // Level 3a — API Server components
    component apiServer "APIComponents" {
      include *
      autolayout lr
    }

    // Level 3b — Web SPA components
    component webSpa "SPAComponents" {
      include *
      autolayout tb
    }

    theme default
  }

}