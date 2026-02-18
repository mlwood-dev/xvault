import { jest } from "@jest/globals";

export function createMockXrplClient() {
  return {
    autofill: jest.fn(async (tx) => ({ ...tx, Sequence: 1, Fee: "12" })),
    submitAndWait: jest.fn(async () => ({
      result: {
        hash: "MOCK_TX_HASH",
        meta: {
          uritoken_id: "MOCK_URI_TOKEN_ID"
        }
      }
    })),
    request: jest.fn(async () => ({
      result: {
        account_data: {
          SigningPubKey: "ED0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd"
        }
      }
    }))
  };
}

export function createMockMultisigSigner() {
  return {
    sign: jest.fn(() => ({ tx_blob: "MOCK_SIGNED_TX_BLOB" }))
  };
}
