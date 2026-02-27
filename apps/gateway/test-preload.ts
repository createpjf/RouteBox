// Set up environment for all tests before any module loads
process.env.OPENAI_API_KEY = "test-openai";
process.env.OPENAI_BASE_URL = "http://localhost:19999/v1";
process.env.ANTHROPIC_API_KEY = "test-anthropic";
process.env.ANTHROPIC_BASE_URL = "http://localhost:19999/v1";
process.env.GOOGLE_API_KEY = "test-google";
process.env.GOOGLE_BASE_URL = "http://localhost:19999/v1";
process.env.FLOCK_API_KEY = "test-flock";
process.env.FLOCK_BASE_URL = "http://localhost:19999/v1";
process.env.ROUTEBOX_TOKEN = "test-token";
process.env.ROUTEBOX_DB_PATH = ":memory:";
