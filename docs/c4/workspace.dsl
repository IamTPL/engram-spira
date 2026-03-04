workspace "Engram Spira" "C4 Architecture — All Levels" {

  model {
    student = person "Student" "A learner who creates and reviews flashcard decks using spaced repetition."

    engramSpira = softwareSystem "Engram Spira" "High-performance spaced-repetition flashcard web app. Manages Classes, Folders, Decks, and Cards and implements the SM-2 SRS algorithm." {

      webSpa = container "Web SPA" "SolidJS single-page application. Handles routing, UI state, and all user interactions. Uses TanStack Query for data fetching and Eden Treaty for type-safe API calls." "SolidJS · TailwindCSS v4 · Bun" {

        router       = component "Router"            "Declares all routes; wraps protected pages in ProtectedRoute / GuestRoute guards."                    "@solidjs/router"
        authStore    = component "Auth Store"        "Reactive signal for currentUser; calls GET /auth/me on mount; exposes login/logout."                  "SolidJS signal"
        edenClient   = component "Eden API Client"   "treaty<App>() — end-to-end type-safe HTTP client; sends session cookie on every request."             "Elysia Eden Treaty"
        queryClient  = component "Query Client"      "TanStack Query cache; provides createQuery / createMutation; invalidates on mutations."               "TanStack Solid Query"

        dashPage     = component "Dashboard Page"    "Shows classes, activity heatmap, streak counter, and due-card notifications."                         "SolidJS page"
        folderPage   = component "Folder View Page"  "Lists and manages decks within a selected folder."                                                     "SolidJS page"
        deckPage     = component "Deck View Page"    "Card list with inline create/edit/delete and template field forms."                                    "SolidJS page"
        studyPage    = component "Study Mode Page"   "Flipcard UI; SM-2 review actions (again/hard/good); keyboard shortcuts; progress bar."                "SolidJS page"
        settingsPage = component "Settings Page"     "User profile editing: display name, avatar URL, password change."                                      "SolidJS page"
        feedbackPage = component "Feedback Page"     "Submits user feedback and bug reports to the API."                                                     "SolidJS page"

        focusDrawer  = component "Focus Drawer"      "Floating overlay for deep-focus study sessions."                                                       "SolidJS component"
        toaster      = component "Toaster"           "Global toast notification overlay."                                                                    "SolidJS component"
        themeStore   = component "Theme Store"       "Dark/light mode toggle; persisted to localStorage."                                                   "SolidJS signal"
      }

      apiServer = container "API Server" "ElysiaJS REST API on Bun. Implements authentication, SRS engine, and all content CRUD. Serves JSON over HTTP with cookie sessions." "ElysiaJS · Bun · Drizzle ORM" {

        authModule     = component "Auth Module"           "POST /auth/register · login · logout · GET /auth/me. Hashes passwords with argon2; issues session tokens." "ElysiaJS Route"
        authMiddleware = component "Auth Middleware"       "Reads session cookie, validates token against DB, injects currentUser into request context."              "ElysiaJS Plugin"
        classesModule  = component "Classes Module"        "CRUD — top-level academic subjects owned by a user."                                                      "ElysiaJS Route"
        foldersModule  = component "Folders Module"        "CRUD — chapters/folders nested inside a class."                                                           "ElysiaJS Route"
        decksModule    = component "Decks Module"          "CRUD — flashcard sets nested inside a folder."                                                            "ElysiaJS Route"
        cardTplModule  = component "Card Templates Module" "Manages reusable field schemas (Vocabulary, Basic Q&A). Field types: text, textarea, image_url, audio_url." "ElysiaJS Route"
        cardsModule    = component "Cards Module"          "CRUD — individual cards with field values keyed to a template."                                            "ElysiaJS Route"
        studyModule    = component "Study / SRS Engine"   "Fetches due cards; processes again/hard/good reviews; updates SM-2 fields; streak & activity stats."       "ElysiaJS Route"
        notifModule    = component "Notifications Module"  "Returns decks with pending due cards."                                                                     "ElysiaJS Route"
        feedbackModule = component "Feedback Module"       "Collects user bug reports and in-app feedback."                                                            "ElysiaJS Route"
        usersModule    = component "Users Module"          "Profile management: display name, avatar URL, password change."                                            "ElysiaJS Route"
        dbClient       = component "Drizzle DB Client"    "Singleton ORM client; executes typed SQL queries against PostgreSQL via DATABASE_URL."                     "Drizzle ORM"
      }

      database = container "PostgreSQL Database" "Stores all user data: accounts, sessions, classes, folders, decks, cards, card templates, study progress, and daily activity logs." "PostgreSQL 15 · Docker"
    }

    // ── Level 1: Context relationships
    student -> engramSpira "Registers, logs in, creates flashcard content, and studies using SRS" "HTTPS"

    // ── Level 2: Container relationships
    student   -> webSpa    "Interacts via browser"                          "HTTPS"
    webSpa    -> apiServer "REST API calls with session cookie"             "HTTP JSON / Eden Treaty"
    apiServer -> database  "Queries and mutations via Drizzle ORM"         "TCP / SQL"

    // ── Level 3a: API components
    authModule     -> dbClient       "Reads/writes users & sessions"           "Drizzle ORM"
    authMiddleware -> dbClient       "Validates session token"                 "Drizzle ORM"
    classesModule  -> authMiddleware "Protected by"
    classesModule  -> dbClient       "Queries classes"                         "Drizzle ORM"
    foldersModule  -> authMiddleware "Protected by"
    foldersModule  -> dbClient       "Queries folders"                         "Drizzle ORM"
    decksModule    -> authMiddleware "Protected by"
    decksModule    -> dbClient       "Queries decks"                           "Drizzle ORM"
    cardTplModule  -> authMiddleware "Protected by"
    cardTplModule  -> dbClient       "Queries card_templates"                  "Drizzle ORM"
    cardsModule    -> authMiddleware "Protected by"
    cardsModule    -> dbClient       "Queries cards, card_field_values"        "Drizzle ORM"
    studyModule    -> authMiddleware "Protected by"
    studyModule    -> dbClient       "Reads/writes study_progress"             "Drizzle ORM"
    notifModule    -> authMiddleware "Protected by"
    notifModule    -> dbClient       "Queries due decks"                       "Drizzle ORM"
    feedbackModule -> authMiddleware "Protected by"
    feedbackModule -> dbClient       "Writes feedback records"                 "Drizzle ORM"
    usersModule    -> authMiddleware "Protected by"
    usersModule    -> dbClient       "Reads/writes user profile"               "Drizzle ORM"
    dbClient       -> database       "TCP SQL"                                 "TCP / SQL"

    // ── Level 3b: SPA components
    router      -> dashPage     "Renders at /"              "SolidJS Router"
    router      -> folderPage   "Renders at /folder/:id"   "SolidJS Router"
    router      -> deckPage     "Renders at /deck/:id"     "SolidJS Router"
    router      -> studyPage    "Renders at /study/:id"    "SolidJS Router"
    router      -> settingsPage "Renders at /settings"     "SolidJS Router"
    router      -> feedbackPage "Renders at /feedback"     "SolidJS Router"
    router      -> authStore    "Reads currentUser signal" "SolidJS signal"
    dashPage     -> queryClient "createQuery / createMutation" "TanStack Query"
    folderPage   -> queryClient "createQuery / createMutation" "TanStack Query"
    deckPage     -> queryClient "createQuery / createMutation" "TanStack Query"
    studyPage    -> queryClient "createQuery / createMutation" "TanStack Query"
    settingsPage -> queryClient "createMutation"               "TanStack Query"
    feedbackPage -> queryClient "createMutation"               "TanStack Query"
    queryClient  -> edenClient  "Calls API functions"          "Eden Treaty"
    authStore    -> edenClient  "Calls /auth/me, login, logout" "Eden Treaty"
    edenClient   -> apiServer   "HTTP JSON + cookie"           "HTTP"
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