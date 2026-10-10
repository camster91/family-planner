import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "../bounded-request-text";
it("cancels a chunked oversized request with no declared length", async () => {
  const reader = {
    read: jest.fn(async () => ({ done: false, value: new Uint8Array(11) })),
    cancel: jest.fn(async () => {}),
    releaseLock: jest.fn(),
  };
  await expect(
    boundedRequestText(
      {
        headers: new Headers(),
        body: { getReader: () => reader },
      } as unknown as Request,
      10,
    ),
  ).rejects.toBeInstanceOf(RequestBodyTooLarge);
  expect(reader.cancel).toHaveBeenCalled();
});
it("checks declared bytes before consuming a body", async () => {
  const text = jest.fn(async () => "small");
  await expect(
    boundedRequestText(
      {
        headers: new Headers({ "content-length": "100" }),
        text,
      } as unknown as Request,
      10,
    ),
  ).rejects.toBeInstanceOf(RequestBodyTooLarge);
  expect(text).not.toHaveBeenCalled();
});
