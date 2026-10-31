document.addEventListener("DOMContentLoaded", () => {
  /**
   * @template {Element} T
   * @param {string} id
   * @param {new (...args: any[]) => T} type
   */
  const queryElement = (id, type) => {
    const el = document.getElementById(id);
    if (!(el instanceof type)) {
      throw new Error(`Expected ${type} for #${id}`);
    }
    return el;
  };

  const els = {
    postForm: queryElement("postForm", HTMLFormElement),
    postFormContent: queryElement("postFormContent", HTMLTextAreaElement),
    postFormSubmit: queryElement("postFormSubmit", HTMLInputElement),
    posts: queryElement("posts", HTMLDivElement),
    inThreadSpan: queryElement("inThreadSpan", HTMLSpanElement),
    inThreadAnchor: queryElement("inThreadAnchor", HTMLAnchorElement),
  };

  const threadId = window.location.pathname.split("/")[2] || null;

  /**
   * @param {any} post
   * @param {boolean} isReply
   */
  const renderPost = (post, isReply) => {
    const postDiv = document.createElement("div");
    postDiv.id = `p${post.id}`;

    if (isReply) {
      postDiv.classList.add("reply");
    }

    postDiv.classList.add("post");

    const heading = document.createElement("span");
    const headingName = document.createElement("span");

    headingName.classList.add("post-name");
    headingName.textContent = post.name;
    heading.append(headingName);

    if (post.tripcode) {
      const tripcodeSpan = document.createElement("span");
      tripcodeSpan.classList.add("post-tripcode");
      tripcodeSpan.textContent = `!${post.tripcode}`;
      heading.append(tripcodeSpan);
    }

    /** @param {number} n */
    const pad = (n) => String(n).padStart(2, "0");

    const d = new Date(post.createdAt);
    const createdAtString =
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

    heading.append(
      document.createTextNode(` ${createdAtString} ID: ${post.id} `),
    );

    if (isReply) {
      const headingReplyAnchor = document.createElement("a");
      headingReplyAnchor.textContent = "Reply";
      headingReplyAnchor.href = "#";
      headingReplyAnchor.classList.add("post-reply");
      headingReplyAnchor.dataset.postId = post.id;
      headingReplyAnchor.addEventListener("click", (event) => {
        event.preventDefault();

        els.postFormContent.focus();
        const postId = headingReplyAnchor.dataset.postId ?? "unknown";
        els.postFormContent.value += `>>${postId}\n`;
      });

      heading.append(headingReplyAnchor);
    }

    postDiv.append(heading);

    if (post.fileUrl) {
      const image = document.createElement("img");
      image.src = post.fileUrl;
      postDiv.append(image);

      image.addEventListener("click", () => {
        image.classList.toggle("expanded");
      });
    }

    const content = document.createElement("span");

    /** @type {string} */
    const escapedContent = post.content.replace(
      /[<>&"']/g,
      /** @param {string} c  */
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );

    const processedContent = escapedContent
      .replace(/\*\*(.+)\*\*/g, "<strong>&#42;&#42;$1&#42;&#42;</strong>")
      .replace(/\*(.+)\*/g, "<i>&#42;$1&#42;</i>")
      .replace(/~~(.+)~~/g, "<s>&#126;&#126;$1&#126;&#126;</s>")
      .replace(/(https?:\/\/\S+)/g, '<a target="_blank" href="$1">$1</a>')
      .replace(/&gt;&gt;([0-9a-f]{8})/g, '<a href="#p$1">&gt;&gt;$1</a>')
      .replace(/^&gt;(.*)$/gm, '<span class="post-quote">&gt;$1</span>')
      .replace(
        /\[([a-z]+)\]/g,
        '<img class="emoji" src="/img/emoji/$1.gif" alt="[$1]" />',
      )
      .replace(
        /&lt;&gt;&lt;|&gt;&lt;&gt;/g,
        '<span class="post-fish-container"><span class="post-fish">&gt;&lt;&gt;</span></span>',
      )
      .replace(/\n/g, "<br />");

    content.innerHTML = processedContent;
    postDiv.append(content);

    Array.from(content.getElementsByTagName("a")).forEach((el) => {
      if (el instanceof HTMLAnchorElement) {
        const href = el.getAttribute("href");

        if (href && /^#p[0-9a-f]{8}$/.test(href)) {
          el.addEventListener("click", () => {
            Array.from(document.getElementsByClassName("highlight")).forEach(
              (el) => {
                el.classList.remove("highlight");
              },
            );

            const targetPost = document.getElementById(href.slice(1));

            if (targetPost instanceof HTMLDivElement) {
              targetPost.classList.add("highlight");
              setTimeout(() => {
                targetPost.classList.remove("highlight");
              }, 5000);
            }
          });
        }
      }
    });

    if (!isReply) {
      const footer = document.createElement("span");
      footer.append(
        document.createTextNode(
          `R: ${post.replyCount} / I: ${post.imageCount} `,
        ),
      );

      const footerViewAnchor = document.createElement("a");
      footerViewAnchor.textContent = "View";
      footerViewAnchor.href = `/thread/${post.id}`;
      footer.append(footerViewAnchor);

      postDiv.append(footer);
    }

    return postDiv;
  };

  const loadPosts = async () => {
    const url = threadId ? `/api/posts?thread=${threadId}` : "/api/posts";
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to load posts");
    }

    if (threadId) {
      els.inThreadSpan.style.display = "inline";
    }

    els.posts.replaceChildren();
    for (let i = 0; i < data.length; i++) {
      if (i > 0 && threadId === null) {
        els.posts.append(document.createElement("hr"));
      }

      els.posts.append(renderPost(data[i], threadId !== null && i > 0));
    }
  };

  els.postForm.reset();
  els.postForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    els.postFormSubmit.disabled = true;

    try {
      const formData = new FormData(els.postForm);
      if (threadId) {
        formData.set("thread", threadId);
      }

      const response = await fetch("/api/posts", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Unable to create post");
      }

      els.postForm.reset();
      await loadPosts();
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Unknown post error",
      );
      console.error(error);
    } finally {
      els.postFormSubmit.disabled = false;
    }
  });

  loadPosts().catch((error) => window.alert(error.message));
});
