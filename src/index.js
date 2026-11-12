import boardPage from "../pages/index.html";
import headerComponent from "../components/header.html";
import postComponent from "../components/post.html";
import threadNoticeComponent from "../components/thread_notice.html";

import postsRoute from "./api/posts.js";

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

/**
 * @param {Request} request
 * @param {any} env
 */
export default async (request, env) => {
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

    const postsResponse = await postsRoute(new Request(postsUrl), env);
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
          const separator = index > 0 ? (!threadId ? "<hr />" : "<br />") : "";
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
};
