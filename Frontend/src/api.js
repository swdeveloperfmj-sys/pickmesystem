export async function api(path, body, method) {
  const response = await fetch(`/api${path}`, {
    method: method || (body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  if (response.status !== 204) {
    const payload = await response.text();
    if (payload.trim()) {
      try {
        data = JSON.parse(payload);
      } catch {
        if (response.ok) {
          const error = new Error("The server returned an invalid response. Please try again.");
          error.status = response.status;
          throw error;
        }
      }
    }
  }
  if (!response.ok) {
    const error = new Error(
      data?.errors?.length
        ? data.errors.map((e) => `${e.field}: ${e.message}`).join(" · ")
        : data?.message || (response.status === 401 ? "Your session has expired. Please sign in again." : "The request failed."),
    );
    error.status = response.status;
    throw error;
  }
  return data;
}
