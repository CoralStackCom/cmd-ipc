/**
 * Helper function to get process command line argument value with format
 * --argName=value
 *
 * @param argName   The name of the argument to get value for
 * @returns         The value of the argument or 'Unknown' if not found
 */
export function getArgumentValue(argName: string): string {
  const arg = process.argv.find((a) => a.startsWith(`--${argName}=`))
  if (arg) {
    // Return the value after the "="
    return arg.split('=')[1]
  }
  // Return 'Unknown' if the argument is not found
  return 'Unknown'
}
