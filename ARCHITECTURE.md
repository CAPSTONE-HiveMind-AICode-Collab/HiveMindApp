# HiveMind Architecture Documentation

## Table of Contents
1. [System Overview](#system-overview)
2. [Component Architecture](#component-architecture)
3. [Data Flow](#data-flow)
4. [Technical Stack](#technical-stack)
5. [Design Decisions & Rationale](#design-decisions--rationale)
6. [Security Architecture](#security-architecture)
7. [Scalability & Performance](#scalability--performance)

---

## System Overview

HiveMind is a collaborative AI-powered workspace application designed for team communication with integrated AI assistance. The system enables real-time messaging, threaded conversations, AI-powered summaries, and voice-to-text capabilities.

### Key Features
- **Real-time Collaboration**: Multi-user workspaces (Hives) with topic-based channels (Honeycombs)
- **AI Integration**: Gemini API integration for contextual responses and automatic thread summaries
- **Voice Accessibility**: Web Speech API for voice-to-text input
- **Advanced Search**: Full-text search across messages and conversations
- **Mobile Responsive**: Tailwind breakpoints for mobile, tablet, and desktop experiences
- **Role-Based Access**: Owner, Admin, Member, Viewer permissions with granular control

---

## Component Architecture

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                            │
├─────────────────────────────────────────────────────────────────┤
│  Next.js App Router (React 18+)                                 │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐ │
│  │  Dashboard   │  Hive View   │  Honeycomb   │  Thread      │ │
│  │  page.jsx    │  page.jsx    │  Chat        │  Panel       │ │
│  └──────────────┴──────────────┴──────────────┴──────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      BUSINESS LOGIC LAYER                       │
├─────────────────────────────────────────────────────────────────┤
│  src/lib/business/                                              │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐ │
│  │ chatService  │ notification │ permission   │              │ │
│  │   .js        │ Service.js   │ Service.js   │              │ │
│  └──────────────┴──────────────┴──────────────┴──────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATA ACCESS LAYER                          │
├─────────────────────────────────────────────────────────────────┤
│  src/lib/data/                                                  │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐ │
│  │ firestore    │ aiRepository │ summary      │ role         │ │
│  │ Repository   │   .js        │ Repository   │ Repository   │ │
│  └──────────────┴──────────────┴──────────────┴──────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL SERVICES LAYER                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐ │
│  │  Firebase    │  Firestore   │  Gemini AI   │  Web Speech  │ │
│  │  Auth        │  Database    │  API         │  API         │ │
│  └──────────────┴──────────────┴──────────────┴──────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

#### 1. **Presentation Layer (Client Components)**

**Dashboard** (`src/app/dashboard/page.jsx`)
- Purpose: User's home view for managing hives
- Responsibilities:
  - Create new hives with unique IDs
  - Join existing hives via ID
  - Display user's hive memberships
  - Delete hives (owner only)
- Key Functions: `createHive()`, `joinHive()`, `deleteHive()`

**Hive View** (`src/app/hive/[hiveID]/page.jsx`)
- Purpose: Overview of honeycombs within a hive
- Responsibilities:
  - List all honeycombs in hive
  - Create new honeycombs
  - Display unread counts per honeycomb
  - Role-based honeycomb access control
- Key Functions: `createHoneycomb()`, `fetchHoneycombs()`

**Honeycomb Chat** (`src/app/hive/[hiveID]/honeycomb/[honeycombID]/page.jsx`)
- Purpose: Main chat interface for team collaboration
- Responsibilities:
  - Real-time message display with pagination
  - Voice-to-text input (Web Speech API)
  - Message search functionality
  - AI interaction (Ask AI button)
  - Thread management
  - Mobile responsive layout
- Key Functions: 
  - `handleSendMessage()`: Send user messages
  - `handleAIReply()`: Request AI responses
  - `handleLoadOlderMessages()`: Pagination
  - `toggleVoiceRecording()`: Voice input
  - `renderMessageText()`: Parse code blocks & markdown

**Thread Panel** (Component in honeycomb page)
- Purpose: Side panel for threaded discussions
- Responsibilities:
  - Display thread messages
  - Send thread replies
  - Close threads and trigger AI summaries
  - Resizable width (desktop only)
- Key Features:
  - Drag-to-resize (320px-800px)
  - Full-screen on mobile
  - Thread status (open/closed)

#### 2. **Business Logic Layer**

**chatService.js** (`src/lib/business/chatService.js`)
- Purpose: Core messaging business logic
- Key Functions:
  - `useSendUserMessage()`: Hook for sending messages
  - `subscribeToChatMessages()`: Real-time message subscription with pagination
  - `loadOlderMessages()`: Cursor-based pagination (50 messages per load)
  - `useSendThreadMessage()`: Thread reply logic
  - `subscribeToThreadMessages()`: Thread real-time updates
  - `closeThreadAndNotify()`: Thread closure + AI summary generation
  - `getUnreadCount()`: Calculate unread messages

**notificationService.js** (`src/lib/business/notificationService.js`)
- Purpose: User notification management
- Key Functions:
  - `notifyUsers()`: Send notifications to multiple users
  - `scheduleTimeBasedNotification()`: Future notification scheduling

**permissionService.js** (`src/lib/business/permissionService.js`)
- Purpose: Role-based permission checks
- Key Functions:
  - `checkPermission()`: Verify user permissions for actions
  - Permission constants: `CREATE_HONEYCOMB`, `SEND_MESSAGE`, `CLOSE_THREAD`, etc.

#### 3. **Data Access Layer**

**firestoreRepository.js** (`src/lib/data/firestoreRepository.js`)
- Purpose: Firestore CRUD operations abstraction
- Key Functions:
  - `getThreadParticipants()`: Fetch thread members
  - `updateThreadStatus()`: Change thread status (open/closed)

**aiRepository.js** (`src/lib/data/aiRepository.js`)
- Purpose: Gemini AI API integration
- Key Functions:
  - `callGeminiAPI(prompt, model)`: Send prompts to Gemini and return responses
  - Handles API errors and retries
  - Model selection (gemini-2.5-flash, gemini-2.5-pro, etc.)

**summaryRepository.js** (`src/lib/data/summaryRepository.js`)
- Purpose: Thread summary generation and storage
- Key Functions:
  - `generateAndStoreThreadSummary()`: Create AI summaries when threads close
  - `listThreadSummaries()`: Retrieve completed task summaries

**roleRepository.js** (`src/lib/data/roleRepository.js`)
- Purpose: User role management
- Key Functions:
  - `setUserRoleForHive()`: Assign roles to users
  - `getUserRoleForHive()`: Fetch user's role in hive
  - Role constants: `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`

#### 4. **Authentication Layer**

**firebaseAuth.js** (`src/lib/auth/firebaseAuth.js`)
- Purpose: Firebase Authentication wrapper
- Key Functions:
  - `signInWithGoogle()`: Google OAuth sign-in
  - `signOutUser()`: User logout
  - `listenToAuthChanges()`: Auth state listener

**userContext.jsx** (`src/lib/auth/userContext.jsx`)
- Purpose: React Context for global user state
- Provides: `user` object, `loading` state throughout app

---

## Data Flow

### 1. User Message Flow

```
User types message → handleSendMessage() 
                   ↓
         chatService.useSendUserMessage()
                   ↓
         Firestore: Add message to /Hive/{hiveID}/Honeycomb/{honeycombID}/messages
                   ↓
         subscribeToChatMessages() onSnapshot listener fires
                   ↓
         Component state updates → UI re-renders
```

### 2. AI Interaction Flow

```
User clicks "Ask AI" → handleAIReply(messageText)
                     ↓
             setSelectedModel (gemini-2.5-flash, etc.)
                     ↓
             aiRepository.callGeminiAPI(prompt, model)
                     ↓
             Gemini API processes prompt → returns response
                     ↓
             chatService.sendAIReply() adds AI message to Firestore
                     ↓
             Real-time listener updates UI with AI response
```

### 3. Thread Closure & Summary Flow

```
User clicks "Close Thread" → closeThreadAndNotify()
                           ↓
         Update thread status to "closed" in Firestore
                           ↓
         getThreadParticipants() → fetch all users in thread
                           ↓
         notifyUsers() → send notifications to participants
                           ↓
         generateAndStoreThreadSummary() 
                           ↓
         Fetch all thread messages → send to Gemini API
                           ↓
         AI generates summary → store in /summaries collection
                           ↓
         UI updates with new summary card
```

### 4. Voice-to-Text Flow

```
User clicks microphone icon → toggleVoiceRecording()
                            ↓
         Check browser support (webkitSpeechRecognition)
                            ↓
         recognition.start() → microphone access request
                            ↓
         User speaks → recognition.onresult fires
                            ↓
         Transcript text appended to message input
                            ↓
         User clicks Send → normal message flow
```

### 5. Search Flow

```
User types in search bar → setSearchQuery(value)
                         ↓
         filteredMessages = messages.filter(...)
                         ↓
         Filter by: message text, sender name (case-insensitive)
                         ↓
         UI re-renders with filtered results
                         ↓
         Show "Found X messages" counter
```

### 6. Pagination Flow

```
User scrolls up → clicks "Load Older Messages"
               ↓
         handleLoadOlderMessages()
               ↓
         Get oldest message timestamp
               ↓
         loadOlderMessages(hiveID, honeycombID, oldestTimestamp, 50)
               ↓
         Firestore query: where("timestamp", "<", oldestTimestamp) + limit(50)
               ↓
         Prepend older messages to state array
               ↓
         If < 50 returned, setHasMoreMessages(false)
```

---

## Technical Stack

### Frontend
- **Framework**: Next.js 14+ (App Router)
- **React**: v18+ with hooks (useState, useEffect, useCallback, useRef)
- **Styling**: Tailwind CSS v3+ with custom utility classes
- **Code Highlighting**: prism-react-renderer with vsDark theme
- **Voice Input**: Web Speech API (browser native)

### Backend & Infrastructure
- **Authentication**: Firebase Authentication (Google OAuth)
- **Database**: Cloud Firestore (NoSQL, real-time)
- **AI**: Google Gemini API (2.5-flash, 2.5-pro models)
- **Hosting**: Vercel (recommended) or Firebase Hosting
- **Environment**: Node.js runtime

### Database Schema (Firestore)

```
Hive (collection)
  └─ {hiveID} (document)
      ├─ name: string
      ├─ ownerId: string
      ├─ members: array<string>
      ├─ createdAt: timestamp
      │
      ├─ Honeycomb (subcollection)
      │   └─ {honeycombID} (document)
      │       ├─ name: string
      │       ├─ createdAt: timestamp
      │       │
      │       ├─ messages (subcollection)
      │       │   └─ {messageID} (document)
      │       │       ├─ text: string
      │       │       ├─ sender: string
      │       │       ├─ senderId: string
      │       │       ├─ timestamp: timestamp
      │       │       │
      │       │       ├─ Threads (subcollection)
      │       │       │   └─ {threadID} (document)
      │       │       │       ├─ text: string
      │       │       │       ├─ sender: string
      │       │       │       ├─ senderId: string
      │       │       │       ├─ timestamp: timestamp
      │       │       │       ├─ status: "open" | "closed"
      │       │       │       │
      │       │       │       └─ userStatus (subcollection)
      │       │       │           └─ {userID}
      │       │       │               └─ lastSeen: timestamp
      │       │       │
      │       │       └─ userStatus (subcollection)
      │       │           └─ {userID}
      │       │               └─ lastSeen: timestamp
      │       │
      │       ├─ summaries (subcollection)
      │       │   └─ {summaryID} (document)
      │       │       ├─ threadID: string
      │       │       ├─ parentMessageID: string
      │       │       ├─ summaryText: string
      │       │       ├─ closedByUserId: string
      │       │       ├─ closedByUserName: string
      │       │       └─ createdAt: timestamp
      │       │
      │       └─ userStatus (subcollection)
      │           └─ {userID}
      │               └─ lastSeen: timestamp
      │
      ├─ members (subcollection)
      │   └─ {userID} (document)
      │       ├─ role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER"
      │       ├─ displayName: string
      │       └─ email: string
      │
      └─ userStatus (subcollection)
          └─ {userID}
              └─ lastSeen: timestamp
```

---

## Design Decisions & Rationale

### 1. **Why Next.js App Router?**

**Decision**: Use Next.js 14+ App Router instead of Pages Router or plain React

**Rationale**:
- **Server Components**: Reduce client bundle size, improve initial load time
- **Streaming**: Progressive rendering for better perceived performance
- **SEO Ready**: Built-in meta tags and server-side rendering capabilities
- **File-based Routing**: Intuitive `/hive/[hiveID]/honeycomb/[honeycombID]` structure
- **API Routes**: Integrated API endpoints (`/api/ai/route.js`)

### 2. **Why Firebase/Firestore?**

**Decision**: Use Firebase suite instead of traditional SQL database

**Rationale**:
- **Real-time Synchronization**: `onSnapshot()` listeners for instant updates across users
- **No Server Management**: Fully managed, auto-scaling infrastructure
- **Offline Support**: Built-in caching and offline mode
- **Security Rules**: Declarative, row-level security at database level
- **Authentication Integration**: Seamless Firebase Auth + Firestore permissions
- **Cost-Effective**: Pay-per-use, free tier covers development and small deployments

**Trade-offs**:
- No complex joins (mitigated with denormalization and subcollections)
- Query limitations (addressed with composite indexes)
- NoSQL learning curve (offset by excellent documentation)

### 3. **Why Google Gemini API?**

**Decision**: Use Gemini instead of OpenAI GPT or other LLMs

**Rationale**:
- **Google Cloud Integration**: Seamless with Firebase infrastructure
- **Multimodal Capabilities**: Future expansion to image/video analysis
- **Cost**: Competitive pricing, free tier for development
- **Performance**: Low latency with Gemini 2.5-flash model
- **Flexibility**: Multiple models (flash, pro) for different use cases

### 4. **Why Cursor-Based Pagination?**

**Decision**: Load messages in batches of 50 using timestamp cursors

**Rationale**:
- **Performance**: Avoid loading thousands of messages at once
- **User Experience**: Faster initial load, smooth "Load More" interaction
- **Firestore Efficiency**: Indexed queries with `limit()` are fast and cheap
- **Scalability**: Works for channels with millions of messages

**Implementation**:
```javascript
query(messagesRef, orderBy("timestamp", "desc"), limit(50))
// For next page:
where("timestamp", "<", oldestTimestamp), limit(50)
```

### 5. **Why Web Speech API?**

**Decision**: Use browser-native speech recognition instead of cloud services

**Rationale**:
- **Zero Cost**: No API calls, no usage limits
- **Privacy**: Audio stays on device, not sent to servers
- **Instant**: No network latency for transcription
- **Progressive Enhancement**: Feature detection, fallback to typing

**Trade-offs**:
- Browser support varies (works in Chrome, Edge, Safari; not Firefox)
- English-focused (though multi-language capable)
- Requires user permission for microphone

### 6. **Why Role-Based Access Control (RBAC)?**

**Decision**: Implement 4-tier role system (Owner, Admin, Member, Viewer)

**Rationale**:
- **Security**: Prevent unauthorized actions (delete, create honeycombs)
- **Scalability**: Support large teams with different permission needs
- **Flexibility**: Granular control over features (e.g., Viewer can read but not send messages)
- **Audit**: Track who performed actions via role checks

**Role Hierarchy**:
```
OWNER    → All permissions (delete hive, manage all)
ADMIN    → Create honeycombs, manage members
MEMBER   → Send messages, create threads
VIEWER   → Read-only access
```

### 7. **Why Tailwind CSS?**

**Decision**: Use utility-first CSS framework

**Rationale**:
- **Rapid Development**: Build UIs faster without context-switching to CSS files
- **Consistency**: Design system tokens (colors, spacing) built-in
- **Performance**: Purges unused styles in production
- **Responsive**: Breakpoint utilities (`sm:`, `md:`, `lg:`) for mobile-first design
- **Maintainability**: No CSS naming conflicts, inline styles are self-documenting

### 8. **Why Component-Based Service Layer?**

**Decision**: Separate business logic (services) from UI components

**Rationale**:
- **Testability**: Services can be unit tested independently
- **Reusability**: `chatService.useSendUserMessage()` used in multiple components
- **Maintainability**: Change Firestore schema without touching UI code
- **Separation of Concerns**: UI renders, services handle data/logic
- **Future-Proofing**: Easy to swap Firestore for another database

---

## Security Architecture

### 1. **Authentication**
- Firebase Authentication with Google OAuth
- No passwords stored, delegated to Google's secure identity platform
- Session management via Firebase Auth tokens (JWT)

### 2. **Authorization**
- Role-based permissions checked in business logic layer
- Firestore Security Rules enforce database-level access control
- Example rule:
```javascript
match /Hive/{hiveID} {
  allow read: if request.auth != null && 
              request.auth.uid in resource.data.members;
  allow delete: if request.auth != null && 
                request.auth.uid == resource.data.ownerId;
}
```

### 3. **Data Validation**
- Client-side: React form validation, type checking
- Server-side: Firestore Security Rules validate data types
- API: Gemini API calls sanitized, no user input directly to prompts without context

### 4. **Privacy**
- Voice input processed locally (Web Speech API, no cloud upload)
- User data scoped to hive membership (can only see hives they're members of)
- No analytics tracking without user consent

---

## Scalability & Performance

### 1. **Database Optimization**

**Indexes** (`firestore.indexes.json`):
- `messages.timestamp DESC` for pagination queries
- `Threads.timestamp ASC` for thread display
- `Threads.status + timestamp` for filtering closed threads

**Pagination**:
- 50 messages per page (configurable)
- Cursor-based (timestamp) to avoid offset performance issues

**Denormalization**:
- User names stored in messages (avoid join on every message)
- Hive membership in both `members` array and `members` subcollection

### 2. **Frontend Optimization**

**Code Splitting**:
- Next.js automatic code splitting by route
- Dynamic imports for heavy components (CodeBlock, ThreadPanel)

**Real-time Subscriptions**:
- Use `onSnapshot` cleanup to prevent memory leaks
- Unsubscribe on component unmount

**Lazy Loading**:
- "Load More" pagination prevents rendering thousands of messages
- Thread panel loads on demand

### 3. **AI Cost Management**

**Model Selection**:
- Default to `gemini-2.5-flash` (fast, cheap) for casual queries
- User can select `gemini-2.5-pro` for complex tasks

**Caching**:
- Thread summaries stored in Firestore (not regenerated)
- Future: Cache common AI responses (FAQ-style)

### 4. **Mobile Performance**

**Responsive Images**: (Future: optimize image uploads with Firebase Storage)
**Touch Targets**: 44px minimum for buttons on mobile
**Reduced Animations**: Conditional animations based on `prefers-reduced-motion`

---

## Future Enhancements

### Short-Term (Next 4 Weeks)
1. **File Upload**: Firebase Storage for attachments
2. **Error Boundaries**: React error boundaries for graceful failures
3. **ESLint/Prettier**: Code quality automation
4. **Unit Tests**: Jest + React Testing Library

### Medium-Term (8-12 Weeks)
1. **Real-time Typing Indicators**: Show who's typing in honeycomb
2. **Read Receipts**: Visual indicators for message read status
3. **Emoji Reactions**: React to messages with emojis
4. **@Mentions**: Notify specific users in messages
5. **Rich Text Editor**: Bold, italic, links in messages

### Long-Term (3-6 Months)
1. **Video/Audio Calls**: WebRTC integration
2. **Mobile App**: React Native or PWA
3. **Integrations**: Slack, Discord, Microsoft Teams bridges
4. **Analytics Dashboard**: Usage metrics, AI query analytics
5. **Self-Hosting**: Docker deployment option

---

## Maintainability Guidelines

### Code Organization
- **One Component Per File**: Except small helper components
- **Service Layer Separation**: No Firestore calls in UI components
- **Type Safety**: JSDoc comments for function signatures (future: TypeScript migration)

### Naming Conventions
- **Components**: PascalCase (e.g., `ThreadPanel`, `SummaryCard`)
- **Functions**: camelCase (e.g., `handleSendMessage`, `loadOlderMessages`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `HIVE_ROLES.OWNER`)

### Documentation
- Inline comments for complex logic
- Function headers with purpose, params, returns
- Architecture docs (this file) updated with major changes

### Testing Strategy
- **Unit Tests**: Service layer functions (chatService, permissionService)
- **Integration Tests**: API routes (`/api/ai`)
- **E2E Tests**: Critical paths (create hive, send message, AI interaction)

---

## Performance Monitoring

### Metrics to Track
1. **Firebase Quota**: Firestore reads/writes per day
2. **AI API Usage**: Gemini tokens consumed, cost per month
3. **Page Load Time**: Next.js performance metrics
4. **Error Rate**: Client-side errors, API failures

### Tools
- Firebase Performance Monitoring
- Next.js Analytics (Vercel)
- Browser DevTools (Lighthouse)
- Sentry (future: error tracking)

---

**Last Updated**: December 2025  
**Version**: 2.0  
**Authors**: HiveMind Development Team
