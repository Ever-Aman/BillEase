import 'package:billease_mobile/ui/document_tax_summary.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('composition shows bill of supply and HSN without GST columns', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: DocumentTaxSummary(
            snapshot: {
              'tax': {
                'documentType': 'bill_of_supply',
                'taxType': 'none',
                'placeOfSupply': '29',
                'lines': [
                  {'lineId': 'l', 'hsn': '1001', 'cgstMinor': '0'},
                ],
              },
            },
          ),
        ),
      ),
    );
    expect(find.text('Bill of Supply'), findsOneWidget);
    expect(find.textContaining('HSN 1001'), findsOneWidget);
    expect(find.textContaining('CGST'), findsNothing);
  });
  testWidgets(
    'regular invoice renders saved separate CGST SGST rates and amounts',
    (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: DocumentTaxSummary(
              snapshot: {
                'tax': {
                  'documentType': 'tax_invoice',
                  'taxType': 'intra',
                  'placeOfSupply': '29',
                  'lines': [
                    {
                      'lineId': 'l',
                      'hsn': '1001',
                      'taxableMinor': '10000',
                      'cgstRateBps': 900,
                      'sgstRateBps': 900,
                      'cgstMinor': '900',
                      'sgstMinor': '900',
                    },
                  ],
                },
              },
            ),
          ),
        ),
      );
      expect(find.text('Tax Invoice'), findsOneWidget);
      expect(find.textContaining('CGST 9%: ₹9.00'), findsOneWidget);
      expect(find.textContaining('SGST 9%: ₹9.00'), findsOneWidget);
    },
  );
  testWidgets('interstate invoice renders IGST without CGST SGST', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: DocumentTaxSummary(
            snapshot: {
              'tax': {
                'documentType': 'tax_invoice',
                'taxType': 'inter',
                'placeOfSupply': '27',
                'lines': [
                  {
                    'lineId': 'l',
                    'hsn': '1001',
                    'taxableMinor': '10000',
                    'igstRateBps': 1800,
                    'igstMinor': '1800',
                  },
                ],
              },
            },
          ),
        ),
      ),
    );
    expect(find.textContaining('IGST 18%: ₹18.00'), findsOneWidget);
    expect(find.textContaining('CGST'), findsNothing);
  });
}
