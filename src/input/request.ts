/**
 * A monotonic counter shared by every device adapter.
 *
 * Gear is the one channel where two devices can disagree without a sensible
 * arithmetic answer: the stick can be blended with the arrow keys, but "drive" and
 * "reverse" cannot. So each adapter stamps the moment it was last asked for a gear,
 * and the combiner takes the newest request. Whichever device the player just
 * touched wins, which is the behaviour they expect.
 */

let sequence = 0;

export function nextInputRequest(): number {
  sequence += 1;
  return sequence;
}
