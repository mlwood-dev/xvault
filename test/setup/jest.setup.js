import { afterEach, jest } from "@jest/globals";

process.env.TZ = "UTC";

afterEach(() => {
  jest.restoreAllMocks();
});
