import { resetSheetGateForTests } from '~/lib/sheet-gate';

// Every test starts with no sheet still closing: one left closing by the test
// before (its clock never run on) would keep the next test's sheets waiting.
beforeEach(() => {
  resetSheetGateForTests();
});
