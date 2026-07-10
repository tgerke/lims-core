/** Domain rule violation; routes map statusCode straight onto the reply. */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
  }
}
