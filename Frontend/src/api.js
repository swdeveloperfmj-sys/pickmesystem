export async function api(path, body, method) {
  const response = await fetch(`/api${path}`, {
    method: method || (body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(
      data?.errors?.length
        ? data.errors.map((e) => `${e.field}: ${e.message}`).join(" · ")
        : data?.message || "The request failed.",
    );
    error.status = response.status;
    throw error;
  }
  return data;
}
