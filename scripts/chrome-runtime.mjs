// Shared Runtime boundary; scenarios own their fixtures, input and assertions.
export function createPageEvaluator(command) {
  if (typeof command !== "function") throw new TypeError("A CDP command function is required");
  return async (expression) => {
    const result = await command("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.text ?? "Runtime evaluation failed");
    }
    return result.result?.value;
  };
}
