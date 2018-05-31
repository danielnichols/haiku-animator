import leftTrim from './leftTrim';
import {EQ, RET} from './ExprSigns';

export default function eqToRet(str: string) {
  let fixed = str;
  if (leftTrim(fixed).substring(0, 1) === EQ) {
    fixed = leftTrim(fixed); // Avoid creating "=    foobar"
    fixed = fixed.slice(1);
    fixed = leftTrim(fixed); // Avoid creating "=    foobar"
    fixed = (RET + ' ') + fixed;
  }
  return fixed;
}
