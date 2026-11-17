const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

export async function api(path, body, method) {
  const response = await fetch(`${apiBaseUrl}/api${path}`, {
    method: method || (body === undefined ? "GET" : "POST"),
    credentials: "include",
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
