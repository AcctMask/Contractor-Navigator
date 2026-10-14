# Actual Assistant / Navigator Development Instructions

## Multilingual development standard — mandatory

English (`en`) and Spanish (`es`) are supported interface languages.

All new or modified user-facing functionality must support both languages
as part of its original implementation. Translation is not a later phase.

### Existing architecture

- Shared React language context:
  `dashboard/src/context/LanguageContext.tsx`
- Shared translation resources:
  `dashboard/src/lib/workforceLanguage.ts`
- Authenticated user preference:
  `preferred_language`
- Existing preference API:
  `dashboard/src/lib/auth.ts`
- Existing individual message translation must remain independent.

### Implementation requirements

1. Use the existing `useLanguage()` architecture for interface language.
2. Place reusable interface translations in the shared translation resources.
3. Avoid introducing independent page-local interface language state.
4. Preserve each authenticated user's saved language preference.
5. Translate new headings, labels, buttons, dialogs, errors, empty states,
   status messages, instructions, and accessibility labels.
6. Preserve stable internal values, database identifiers, workflow states,
   API payloads, permissions, and business calculations.
7. Never automatically rewrite original notes, SMS, customer messages,
   insurance records, financial records, or other evidence.
8. Keep individual note/SMS translation separate from interface localization.
9. Keep tenant-specific and role-specific permissions unchanged unless
   the owner explicitly authorizes a change.
10. Apply this standard to new features and enhancements, including
    subcontractor, crew, and tenant interfaces.

### Acceptance requirements

Before presenting a user-facing enhancement as complete:

- Verify English and Spanish rendering for all affected interface text.
- Verify language selection and persistence where applicable.
- Verify that switching languages does not alter stored business data.
- Verify that existing notes/SMS translation remains available.
- Run relevant frontend checks and report any unverified live behavior.
- Do not claim multilingual acceptance solely from a successful build.

### Scope and governance

This file governs development in this repository. Other Actual Assistant
repositories must explicitly adopt equivalent guidance.

Do not change authentication, authorization, tenant boundaries, financial
logic, operational workflows, or message delivery solely for localization.

Do not commit, push, or deploy without explicit owner approval.
