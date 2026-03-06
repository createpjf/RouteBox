// ---------------------------------------------------------------------------
// Shared Hono env type — declares context variables set by middleware
// ---------------------------------------------------------------------------

export type CloudEnv = {
  Variables: {
    requestId: string;
    userId: string;
    email: string;
    userPlan: string;
  };
};
