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

  const postForm = queryElement("postForm", HTMLFormElement);
  const postFormContent = queryElement("postFormContent", HTMLTextAreaElement);
  const postFormSubmit = queryElement("postFormSubmit", HTMLInputElement);
  const emojiPicker = queryElement("emojiPicker", HTMLDivElement);

  const threadId = window.location.pathname.split("/")[2] || null;

  document.querySelectorAll('.post a[href^="#p"]').forEach((anchor) => {
    anchor.addEventListener("click", () => {
      const href = anchor.getAttribute("href");
      if (!href || !/^#p[0-9a-f]{8}$/.test(href)) {
        return;
      }

      document.querySelectorAll(".highlight").forEach((el) => {
        el.classList.remove("highlight");
      });

      const targetPost = document.getElementById(href.slice(1));
      if (targetPost instanceof HTMLDivElement) {
        targetPost.classList.add("highlight");
        setTimeout(() => targetPost.classList.remove("highlight"), 5000);
      }
    });
  });

  document.querySelectorAll(".post > img").forEach((image) => {
    image.addEventListener("click", () => image.classList.toggle("expanded"));
  });

  document.querySelectorAll('.post > div > a[href="#"]').forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      event.preventDefault();

      const post = anchor.closest(".post");
      if (!(post instanceof HTMLDivElement)) {
        return;
      }

      postFormContent.focus();
      postFormContent.value += `>>${post.id.slice(1)}\n`;
    });
  });

  emojiPicker.querySelectorAll("button[data-emoji]").forEach((button) => {
    button.addEventListener("click", () => {
      const emoji = button.dataset.emoji;
      if (emoji) {
        postFormContent.value += `[${emoji}]`;
      }
    });
  });

  postForm.reset();
  postForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    postFormSubmit.disabled = true;

    try {
      const formData = new FormData(postForm);
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

      window.location.reload();
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Unknown post error",
      );
      console.error(error);
      postFormSubmit.disabled = false;
    }
  });
});
