import { APIGatewayProxyHandlerV2 } from 'aws-lambda';

export const handler: APIGatewayProxyHandlerV2 = async (event: any) => {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Hello from Lambda!" }),
  }
}