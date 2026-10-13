namespace sample;

entity Products {
  key ID    : Integer;
      name  : String(100);
      stock : Integer;
      price : Decimal(9, 2);
}
