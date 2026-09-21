# HTTP API

All paths begin `/api`. JSON bodies use `Content-Type: application/json`. Every request requires trusted `oai-authenticated-user-id` and `oai-authenticated-user-email` headers from the host gateway. Browsers do not set these themselves. The optional local adapter supplies its own local identity.

| Method | Path | Behavior |
|---|---|---|
| GET | `/session` | Current user and storage availability |
| GET | `/projects` | Projects where the user is a member |
| POST | `/projects` | Create `{state}` with owner membership and initial version |
| GET | `/projects/:id` | `{id,state,revision,role,updatedAt}` |
| PUT | `/projects/:id` | Save `{state,revision}`; returns next revision or409 latest state |
| DELETE | `/projects/:id` | Owner-only project/metadata/media deletion |
| GET | `/projects/:id/versions` | Snapshot metadata |
| POST | `/projects/:id/versions` | Snapshot current saved state with `{label}` |
| GET | `/projects/:id/versions/:versionId` | Snapshot state and revision |
| GET | `/projects/:id/comments` | Frame-linked review notes |
| POST | `/projects/:id/comments` | `{body,frame,drawing}`; drawing is arrays of normalized point strokes |
| PATCH | `/projects/:id/comments/:commentId` | `{resolved:boolean}` |
| DELETE | `/projects/:id/comments/:commentId` | Author or owner deletion |
| GET | `/projects/:id/members` | Members and recent presence |
| PATCH | `/projects/:id/members/:userId` | Owner sets `{role:'editor'|'reviewer'}` |
| DELETE | `/projects/:id/members/:userId` | Owner removes another member |
| POST | `/projects/:id/presence` | Upsert `{frame}` and return recent presence |
| POST | `/projects/:id/invite` | Owner creates `{role:'editor'|'reviewer'}` invite; returns token |
| DELETE | `/projects/:id/invite` | Owner revokes all outstanding invites |
| POST | `/join` | Join using `{token}` |
| POST | `/projects/:id/assets` | Editor uploads raw media bytes; content type and percent-encoded `X-File-Name` |
| GET | `/assets/:assetId` | Authorized private bytes; supports `Range: bytes=start-end` |

JSON errors use `{error:string}` and an appropriate status. Authentication401; unavailable membership404; denied role403; invalid payload400; stale revision409; oversized upload413; unsupported media415; storage failure503. The client preserves unsaved edits when a save fails and never treats a non-2xx response as success.

Invites do not grant permission to access the outer hosted Site and do not send email. They authorize membership only after a successfully authenticated visitor submits the token. Existing membership roles are not silently upgraded by joining another invitation.
