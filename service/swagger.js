/**
 * OpenAPI 3.0 Specification for SnipURL Developer REST API (/api/v1)
 */
const swaggerSpec = {
  openapi: "3.0.3",
  info: {
    title: "SnipURL Developer API",
    version: "1.0.0",
    description:
      "Programmatic URL shortening, link management, and visitor analytics API. Generate an API key from your SnipURL dashboard.",
  },
  servers: [{ url: "/", description: "Current server" }],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Pass your API key as: Authorization: Bearer snip_...",
      },
      ApiKeyHeader: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description: "Alternative header: x-api-key: snip_...",
      },
    },
  },
  security: [{ BearerAuth: [] }, { ApiKeyHeader: [] }],
  paths: {
    "/health": {
      get: {
        summary: "Service health check",
        security: [],
        responses: {
          200: { description: "MongoDB & Redis status" },
        },
      },
    },
    "/api/v1/shorten": {
      post: {
        summary: "Create a short URL",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["url"],
                properties: {
                  url: { type: "string", example: "https://example.com/landing" },
                  customAlias: { type: "string", example: "summer-sale" },
                  expiresAt: { type: "string", format: "date", example: "2027-01-01" },
                  maxClicks: { type: "integer", example: 100 },
                  password: { type: "string", example: "secret123" },
                  tags: {
                    type: "array",
                    items: { type: "string" },
                    example: ["marketing", "q4"],
                  },
                  utmSource: { type: "string", example: "twitter" },
                  utmMedium: { type: "string", example: "social" },
                  utmCampaign: { type: "string", example: "launch" },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Short URL created" },
          400: { description: "Validation error" },
          401: { description: "Invalid or missing API key" },
          409: { description: "Duplicate URL or alias already taken" },
        },
      },
    },
    "/api/v1/links": {
      get: {
        summary: "List your shortened links",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" }, description: "Search alias or URL" },
          { name: "tag", in: "query", schema: { type: "string" }, description: "Filter by tag" },
          {
            name: "sort",
            in: "query",
            schema: { type: "string", enum: ["newest", "oldest", "most_clicked"] },
          },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
        ],
        responses: {
          200: { description: "Paginated list of links" },
          401: { description: "Unauthorized" },
        },
      },
    },
    "/api/v1/analytics/{id}": {
      get: {
        summary: "Get link analytics",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          {
            name: "range",
            in: "query",
            schema: { type: "string", enum: ["24h", "7d", "30d", "all"], default: "all" },
          },
        ],
        responses: {
          200: { description: "Click breakdown (human vs bot, unique, geo, browser, referrer)" },
          404: { description: "Link not found" },
        },
      },
    },
    "/api/v1/links/{id}": {
      patch: {
        summary: "Update destination URL",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["redirectId"],
                properties: { redirectId: { type: "string", example: "https://new-target.com" } },
              },
            },
          },
        },
        responses: {
          200: { description: "Destination updated & cache invalidated" },
          404: { description: "Link not found" },
        },
      },
      delete: {
        summary: "Delete a short link",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: { description: "Deleted & cache cleared" },
          404: { description: "Link not found" },
        },
      },
    },
  },
};

module.exports = swaggerSpec;
