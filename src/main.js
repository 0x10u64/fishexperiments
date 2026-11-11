import { randomUUID } from "node:crypto";

import infoPage from "../pages/info.html";
import boardPage from "../pages/index.html";
import rulesPage from "../pages/rules.html";

import headerComponent from "../components/header.html";
import postComponent from "../components/post.html";
import threadNoticeComponent from "../components/thread_notice.html";

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * @param {string} content
 * @param {boolean} [resolveHeader]
 */
const serveHtml = (content, resolveHeader = true) => {
  const processedContent = resolveHeader
    ? content.replaceAll("{header}", headerComponent)
    : content;

  return new Response(processedContent, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
};

/**
 * @param {any} post
 * @param {boolean} isReply
 * @param {string | null} threadId
 */
const renderPost = (post, isReply, threadId) => {
  /**
   * @param {unknown} value
   */
  const escapeHtml = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (character) =>
        /** @type {Object<string, string>} */ ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );

  /**
   * @param {number} n
   */
  const pad = (n) => String(n).padStart(2, "0");

  const d = new Date(post.createdAt);
  const createdAt =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  const escapedContent = escapeHtml(post.content);
  const content = escapedContent
    .replace(/\*\*(.+)\*\*/g, "<strong>&#42;&#42;$1&#42;&#42;</strong>")
    .replace(/\*(.+)\*/g, "<i>&#42;$1&#42;</i>")
    .replace(/~~(.+)~~/g, "<s>&#126;&#126;$1&#126;&#126;</s>")
    .replace(/(https?:\/\/\S+)/g, '<a target="_blank" href="$1">$1</a>')
    .replace(/&gt;&gt;([0-9a-f]{8})/g, '<a href="#p$1">&gt;&gt;$1</a>')
    .replace(
      /(&lt;&gt;&lt;)|(&gt;&lt;&gt;)/g,
      '<span class="post-fish-container"><span class="post-fish">&gt;&lt;&gt;</span></span>',
    )
    .replace(/^&gt;(.*)$/gm, '<span class="post-quote">&gt;$1</span>')
    .replace(
      /\[([a-z]+)\]/g,
      '<img class="emoji" src="/img/emoji/$1.gif" alt="[$1]" />',
    )
    .replace(/\n/g, "<br />");

  const replyHref =
    isReply || threadId === post.id ? "#" : `/thread/${post.id}`;

  const tripcode = post.tripcode
    ? `<span class="post-tripcode">!${post.tripcode}</span>`
    : "";

  const image = post.fileUrl ? `<img src="${post.fileUrl}" />` : "";

  const footer = isReply
    ? ""
    : `<div>R: ${post.replyCount} / I: ${post.imageCount} <a href="/thread/${post.id}">View</a></div>`;

  /** @type {Object<string, string>} */
  const values = {
    id: post.id,
    classes: isReply ? "reply" : "",
    name: escapeHtml(post.name),
    tripcode,
    createdAt,
    replyHref,
    image,
    content,
    footer,
  };

  return postComponent.replace(
    /\{(id|classes|name|tripcode|createdAt|replyHref|image|content|footer)\}/g,
    (_, key) => values[key],
  );
};

/** @type {Object<string, Function>} */
const routes = {
  "/":
    /**
     * @param {Request} request
     * @param {any} env
     */
    async (request, env) => {
      const url = new URL(request.url);
      const threadId = url.pathname.startsWith("/thread/")
        ? url.pathname.split("/")[2] || null
        : null;

      try {
        await env.DB.prepare(
          `
          CREATE TABLE IF NOT EXISTS kv_store (
            key TEXT PRIMARY KEY,
            value TEXT
          )
        `,
        ).run();

        await env.DB.prepare(
          `
          INSERT INTO kv_store (key, value)
          VALUES ('visits', '1')
          ON CONFLICT(key) DO UPDATE
          SET value = CAST(kv_store.value AS INTEGER) + 1
        `,
        ).run();

        const visits = await env.DB.prepare(
          "SELECT value FROM kv_store WHERE key = ?",
        )
          .bind("visits")
          .first("value");

        if (visits === null) {
          throw new Error("Unable to retrieve visit count");
        }

        const postsUrl = new URL("/api/posts", request.url);
        if (threadId) {
          postsUrl.searchParams.set("thread", threadId);
        }

        const postsResponse = await routes["/api/posts"](
          new Request(postsUrl),
          env,
        );
        const postsData = await postsResponse.json();
        if (!postsResponse.ok) {
          throw new Error(postsData.error || "Unable to load posts");
        }

        const renderedPosts = postsData
          .map(
            /**
             * @param {any} post
             * @param {number} index
             * @returns
             */
            (post, index) => {
              const separator =
                index > 0 ? (!threadId ? "<hr />" : "<br />") : "";
              const renderedPost = renderPost(
                post,
                threadId !== null && index > 0,
                threadId,
              );
              return separator + renderedPost;
            },
          )
          .join("");

        const content = boardPage
          .replaceAll("{header}", headerComponent)
          .replaceAll("{visits}", String(visits))
          .replaceAll("{threadNotice}", threadId ? threadNoticeComponent : "")
          .replaceAll("{posts}", renderedPosts);

        return serveHtml(content, false);
      } catch (err) {
        return Response.json(
          {
            error: err instanceof Error ? err.message : "Visit count error",
          },
          { status: 500 },
        );
      }
    },
  "/info": () => serveHtml(infoPage),
  "/rules": () => serveHtml(rulesPage),
  "/api/posts":
    /**
     * @param {Request} request
     * @param {any} env
     */
    async (request, env) => {
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
