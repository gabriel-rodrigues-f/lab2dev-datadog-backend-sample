using sample from '../db/schema';

service CatalogService {
  @readonly
  entity Products as projection on sample.Products;

  type OrderResult {
    orderId        : UUID;
    remainingStock : Integer;
  }

  /** Baixa o estoque: info no sucesso, warn com estoque baixo, 409 sem estoque, 404 produto inexistente. */
  action placeOrder(product : Integer, quantity : Integer) returns OrderResult;

  /** Escreve uma linha de log no nível pedido (debug, info, warn ou error). */
  action emitLog(level : String, message : String)        returns String;

  /** Sempre falha com 500, para ver o erro e o stack trace no Datadog. */
  action fail();
}
