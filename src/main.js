import { randomUUID } from "node:crypto";

import infoPage from "../pages/info.html";
import boardPage from "../pages/index.html";
import emojiPage from "../pages/emoji.html";
import rulesPage from "../pages/rules.html";

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * @param {string} content
 */
const serveHtml = (content) => {
  return new Response(content, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
};

/** @type {Object<string, Function>} */
const routes = {
  "/": () => serveHtml(boardPage),
  "/info": () => serveHtml(infoPage),
  "/emoji": () => serveHtml(emojiPage),
  "/rules": () => serveHtml(rulesPage),
  "/api/posts": async (
    /** @type {Request} */ request,
    /** @type {any} */ env,
  ) => {
    try {
      await env.DB.prepare(
        `
          CREATE TABLE IF NOT EXISTS posts (
            id TEXT PRIMARY KEY,
            thread_id TEXT,
            name TEXT,
            tripcode TEXT,
            content TEXT,
            file_name TEXT,
            created_at TEXT,
            updated_at TEXT
          )
        `,
      ).run();
    } catch (err) {
      return Response.json(
        {
          error: err instanceof Error ? err.message : "DB init error",
        },
        { status: 500 },
      );
    }

    const s3 = new S3Client({
      region: "eu-central-003",
      endpoint: "https://s3.eu-central-003.backblazeb2.com",
      credentials: {
        accessKeyId: env.B2_KEY_ID,
        secretAccessKey: env.B2_APPLICATION_KEY,
      },
    });

    if (request.method === "GET") {
      try {
        const threadId = new URL(request.url).searchParams.get("thread");

        const columns = `
          id, thread_id as threadId,
          name, tripcode, content,
          file_name as fileName,
          created_at as createdAt,
          CASE WHEN thread_id is NULL THEN updated_at END as updatedAt,
          CASE WHEN thread_id IS NULL THEN
          (SELECT COUNT(*) FROM posts replies
            WHERE replies.thread_id = posts.id)
          END as replyCount,
          CASE WHEN thread_id IS NULL THEN
          (SELECT COUNT(*) FROM posts replies
            WHERE replies.thread_id = posts.id
            AND replies.file_name IS NOT NULL)
          END as imageCount
        `;

        const query = threadId
          ? {
              sql: `
                SELECT ${columns} FROM posts
                WHERE id = ? OR thread_id = ?
                ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, created_at ASC
              `,
              bindings: [threadId, threadId, threadId],
            }
          : {
              sql: `
                SELECT ${columns} FROM posts
                WHERE thread_id IS NULL
                ORDER BY updated_at DESC
                LIMIT 16
              `,
              bindings: [],
            };

        const { results } = await env.DB.prepare(query.sql)
          .bind(...query.bindings)
          .all();

        const posts = await Promise.all(
          results.map(async (/** @type {any} */ post) => {
            let fileUrl = null;

            if (post.fileName) {
              const command = new GetObjectCommand({
                Bucket: "fishexperiments",
                Key: post.fileName,
              });

              fileUrl = await getSignedUrl(s3, command, {
                expiresIn: 60,
              });
            }

            return {
              ...post,
              fileUrl,
            };
          }),
        );

        return Response.json(posts);
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : "GET error" },
          { status: 500 },
        );
      }
    }

    if (request.method === "POST") {
      try {
        const formData = await request.formData();

        const threadId = formData.get("thread") ?? null;

        if (threadId) {
          const parent = await env.DB.prepare(
            `
              SELECT id from posts
              WHERE id = ? AND thread_id IS NULL
            `,
          )
            .bind(threadId)
            .first();

          if (!parent) {
            return Response.json(
              { error: "Thread not found" },
              { status: 404 },
            );
          }
        }

        const postId = Array.from({ length: 8 }, () =>
          Math.floor(Math.random() * 16).toString(16),
        ).join("");

        const name = String(formData.get("name") || "Anonymous").trim();
        if (name.includes("!")) {
          return Response.json({ error: "Name is invalid" }, { status: 400 });
        }

        const rawTripcode = String(formData.get("tripcode") || "").trim();
        const tripcode = rawTripcode
          ? Array.from(
              new Uint8Array(
                await crypto.subtle.digest(
                  "SHA-256",
                  new TextEncoder().encode(rawTripcode),
                ),
              ),
              (byte) => byte.toString(16).padStart(2, "0"),
            )
              .join("")
              .slice(0, 8)
          : null;

        const content = String(formData.get("content") || "").trim();
        if (!content) {
          return Response.json(
            { error: "Content is required" },
            { status: 400 },
          );
        }

        if (new TextEncoder().encode(content).byteLength > 256) {
          return Response.json(
            { error: "Content must be 256 bytes or less" },
            { status: 400 },
          );
        }

        const file = formData.get("file") || null;

        let fileName = null;
        if (file && typeof file === "object" && file.name) {
          if (file.size > 4 * 1024 * 1024) {
            return Response.json(
              { error: "Image must be 4 MB or smaller" },
              { status: 400 },
            );
          }

          fileName = `${randomUUID()}-${file.name}`;

          await s3.send(
            new PutObjectCommand({
              Bucket: "fishexperiments",
              Key: fileName,
              Body: new Uint8Array(await file.arrayBuffer()),
              ContentType: file.type,
            }),
          );
        }

        const now = new Date().toISOString();

        await env.DB.prepare(
          `
            INSERT INTO posts (
              id,
              thread_id,
              name,
              tripcode,
              content,
              file_name,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
          .bind(
            postId,
            threadId,
            name,
            tripcode,
            content,
            fileName,
            now,
            threadId ? null : now,
          )
          .run();

        if (threadId) {
          await env.DB.prepare(
            `
              UPDATE posts
              SET updated_at = ?
              WHERE id = ?
            `,
          )
            .bind(now, threadId)
            .run();
        }

        return Response.json(
          {
            id: postId,
            threadId,
            name,
            tripcode,
            content,
            createdAt: now,
            updatedAt: threadId ? null : now,
          },
          { status: 201 },
        );
      } catch (err) {
        return Response.json(
          {
            error: err instanceof Error ? err?.message : "POST error",
          },
          { status: 500 },
        );
      }
    }

    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, POST" },
    });
  },
};

export default {
  /**
   * @param {Request} request
   * @param {any} env
   */
  async fetch(request, env) {
    const clientIp = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success: rlSuccess } = await env.RL.limit({ key: clientIp });
    if (!rlSuccess) {
      return new Response(null, { status: 429 });
    }

    const url = new URL(request.url);

    const route =
      routes[url.pathname] ||
      (url.pathname.startsWith("/thread/") ? routes["/"] : null);

    if (route) {
      return route(request, env);
    }
  },
};
