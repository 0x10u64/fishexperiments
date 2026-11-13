import headerComponent from "../components/header.html";

/**
 * @param {string} value
 * @returns {string}
 */
export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      /** @type {Object<string, string>} */
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );

/**
 * @param {string} content
 * @returns {Response}
 */
export const serveHtml = (content) => {
  return new Response(content.replaceAll("{header}", headerComponent), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
};

export default { escapeHtml, serveHtml };
