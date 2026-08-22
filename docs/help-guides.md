# Contextual help guides

Qualyra provides route-aware help without mixing product instructions with controlled GMP procedures. Every built-in role receives `help_guides.read`. Administrator and Document Controller additionally receive `help_guides.manage` and `help_guides.publish` by default.

## Content model

The API combines two sources:

- system guides are versioned application content maintained with the Qualyra release;
- tenant guides are organization-specific drafts and publications stored under row-level security.

Each tenant guide belongs to one application context, has bilingual Spanish and English content, an ordered list of walkthrough steps, and optional image, video, and official-resource links. A tenant can publish several guides for the same context and control their display order.

Editing a published guide creates a separate draft revision. Users continue to receive the current published revision until the draft is explicitly published. Publication retires the previous revision but keeps it immutable in history. Retiring a guide removes it from contextual help without deleting its revisions or feedback.

## GMP boundary

Help guides explain how to use Qualyra. They are not a substitute for a procedure, work instruction, or SOP. Regulated instructions remain controlled documents with review, approval, effective-version control, periodic review, and training. A help guide may link to the organization's official resource.

## API routes

| Method  | Route                             | Permission            | Purpose                                                                |
| ------- | --------------------------------- | --------------------- | ---------------------------------------------------------------------- |
| `GET`   | `/help-guides/context/:context`   | `help_guides.read`    | Combine published tenant guides with the system default for the screen |
| `POST`  | `/help-guides/:guideKey/feedback` | `help_guides.read`    | Store or replace the current user's helpful/not-helpful response       |
| `GET`   | `/help-guides`                    | `help_guides.manage`  | List tenant drafts, publications, history, and feedback totals         |
| `POST`  | `/help-guides`                    | `help_guides.manage`  | Create a tenant guide and its first draft                              |
| `PATCH` | `/help-guides/:guideId`           | `help_guides.manage`  | Save the current draft or create a new draft above a publication       |
| `POST`  | `/help-guides/:guideId/publish`   | `help_guides.publish` | Publish the draft and retire the prior publication                     |
| `POST`  | `/help-guides/:guideId/archive`   | `help_guides.publish` | Retire and archive a tenant guide                                      |

Tenant guide tables use composite tenant foreign keys and forced PostgreSQL row-level security. Published and retired revision content is protected from mutation by a database trigger. Management actions append tenant security events.
