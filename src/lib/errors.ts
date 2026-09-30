/** An error whose message is safe to show the user, with the HTTP status to return. */
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
