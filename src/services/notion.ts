import { Client } from "@notionhq/client";
import type {
  BlockObjectRequest,
  CreatePageResponse,
  PageObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";
import { marked } from "marked";
import type { Tokens } from "marked";

/** Create a Notion page from cleaned Markdown. */
export async function createNotionPageFromMarkdown(params: {
  notionToken: string;
  databaseId: string;
  markdown: string;
  /** Optional explicit page title. If omitted, we’ll try to derive from first H1. */
  explicitTitle?: string;
}): Promise<{ pageId: string; url?: string; title: string }> {
  const { notionToken, databaseId, markdown, explicitTitle } = params;
  if (!notionToken) throw new Error("Missing Notion token");
  if (!databaseId) throw new Error("Missing Notion databaseId");
  if (!markdown?.trim()) throw new Error("Markdown content is empty");

  const notion = new Client({ auth: notionToken });

  // Build blocks from markdown (simple mapping; extend as you wish)
  const blocks = markdownToNotionBlocks(markdown);
  if (!blocks.length) throw new Error("No content could be derived from markdown");

  // Determine page title: explicit > first H1 > fallback
  let derivedTitle = explicitTitle?.trim() || "New Note";
  const firstBlock = blocks[0];
  if (firstBlock && firstBlock.type === "heading_1" && firstBlock.heading_1?.rich_text?.[0]?.type === "text") {
    derivedTitle = firstBlock.heading_1.rich_text[0].text.content || derivedTitle;
    blocks.shift(); // remove the H1 from children so it isn't duplicated
  }

  // Retrieve the DB to locate the actual *title* property key (often “Name”, but not guaranteed).
  // Notion requires properties to match the database schema when creating pages in a database. :contentReference[oaicite:0]{index=0}
  const db = await notion.databases.retrieve({ database_id: databaseId }); // :contentReference[oaicite:1]{index=1}
  let titleProp = "Name";
  for (const [propName, prop] of Object.entries(db.properties) as Array<[string, { type: string }]>) {
    if (prop.type === "title") {
      titleProp = propName;
      break;
    }
  }

  // Create the page with children blocks. Notion supports providing `children` when creating a page. :contentReference[oaicite:2]{index=2}
  const created: CreatePageResponse = await notion.pages.create({
    parent: { database_id: databaseId },
    properties: {
      [titleProp]: {
        title: [{ type: "text", text: { content: derivedTitle } }],
      },
    },
    children: blocks,
  }); // :contentReference[oaicite:3]{index=3}

  return {
    pageId: created.id,
    url: (created as PageObjectResponse).url, // present for database children
    title: derivedTitle,
  };
}

/** Minimal Markdown → Notion Blocks mapper (H1–H3, paragraph, code, bulleted list). */
export function markdownToNotionBlocks(markdown: string): BlockObjectRequest[] {
  const tokens = marked.lexer(markdown || ""); // Marked's lexer gives us token stream we can map over. :contentReference[oaicite:4]{index=4}
  const blocks: BlockObjectRequest[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "heading": {
        const depth = (token as Tokens.Heading).depth;
        const text = String((token as Tokens.Heading).text || "");
        if (depth === 1) {
          blocks.push({
            object: "block",
            type: "heading_1",
            heading_1: { rich_text: [{ type: "text", text: { content: text } }] },
          });
        } else if (depth === 2) {
          blocks.push({
            object: "block",
            type: "heading_2",
            heading_2: { rich_text: [{ type: "text", text: { content: text } }] },
          });
        } else {
          blocks.push({
            object: "block",
            type: "heading_3",
            heading_3: { rich_text: [{ type: "text", text: { content: text } }] },
          });
        }
        break;
      }

      case "paragraph": {
        const text = String((token as Tokens.Paragraph).text || "");
        blocks.push({
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ type: "text", text: { content: text } }] },
        });
        break;
      }

      case "code": {
        const t = token as Tokens.Code;
        blocks.push({
          object: "block",
          type: "code",
          code: {
            rich_text: [{ type: "text", text: { content: String(t.text || "") } }],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            language: t.lang && t.lang.length > 0 ? t.lang : ("plain text" as any),
          },
        });
        break;
      }

      case "list": {
        // Map any list items to bulleted_list_item for simplicity.
        // You can extend this to `numbered_list_item` by checking token.ordered. :contentReference[oaicite:5]{index=5}
        const list = token as Tokens.List;
        for (const item of list.items || []) {
          blocks.push({
            object: "block",
            type: "bulleted_list_item",
            bulleted_list_item: {
              rich_text: [{ type: "text", text: { content: String(item.text || "") } }],
            },
          });
        }
        break;
      }

      case "space":
        // ignore spacing tokens
        break;

      default:
        // unsupported token types are skipped to keep implementation small
        break;
    }
  }

  return blocks;
}
