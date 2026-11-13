import indexRoute from "./index.js";
import postsRoute from "./api/posts.js";
import { serveHtml } from "./utils.js";

import infoPage from "../pages/info.html";
import rulesPage from "../pages/rules.html";
import notFoundPage from "../pages/404.html";

/** @type {Object<string, Function>} */
const routes = {
  "/": indexRoute,
  "/info": () => serveHtml(infoPage),
  "/rules": () => serveHtml(rulesPage),
  "/api/posts": postsRoute,
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

    /** @type {Response} */
    const assetResponse = await env.ASSETS.fetch(request);

    if (assetResponse.status === 404) {
      return serveHtml(notFoundPage);
    }

    return assetResponse;
  },
};
