import * as React from 'react';
import * as dedent from 'dedent';
import {PUBLISH_SHARED} from './PublishStyles';
import {CodeBox} from '../../CodeBox';

export type EmbedProps = {
  projectName: string;
  userName: string;
  organizationName: string;
  projectUid: string;
  sha: string;
};

export default class Embed extends React.PureComponent<EmbedProps> {
  get cdnBase() {
    const cdnBase = 'https://cdn.haiku.ai/';

    return `${cdnBase + this.props.projectUid}/${this.props.sha}/`;
  }

  render () {
    const {userName, projectName, organizationName, sha} = this.props;
    const scriptPath = `https://code.haiku.ai/scripts/core/HaikuCore.${process.env.HAIKU_RELEASE_VERSION}.min.js`;
    const embedPath = `${this.cdnBase}index.embed.js`;

    return (
      <div style={PUBLISH_SHARED.block}>
        <div style={PUBLISH_SHARED.instructionsRow}>
          <div style={PUBLISH_SHARED.instructionsCol1}>
          </div>
          <div style={PUBLISH_SHARED.instructionsCol2}>
            Example usage: <br />
          </div>
        </div>
        <div style={PUBLISH_SHARED.instructionsRow}>
          <div style={PUBLISH_SHARED.instructionsCol1}>&nbsp;</div>
          <div style={PUBLISH_SHARED.instructionsCol2}>
            <CodeBox>
              {dedent`
                <div id="mount-${sha}"></div>
                <script src="${scriptPath}"></script>
                <script src="${embedPath}"></script>
                <script>
                  HaikuComponentEmbed_${organizationName}_${projectName}(
                    document.getElementById('mount-${sha}'),
                    {loop: true}
                  );
                </script>
              `}
            </CodeBox>
          </div>
        </div>
       </div>
    );
  }
}
