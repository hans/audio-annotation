import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ReloadOutlined, SaveOutlined, InfoCircleTwoTone, EyeTwoTone, ToolTwoTone } from '@ant-design/icons'
import { Typography, Tag, Layout, PageHeader, Button, Space, Menu, Dropdown } from 'antd'
import { useRouter } from '../Misc'
import '../App.less'
import EditorUI from '../components/EditorUI'
import MessagePane from '../components/MessagePane'
import * as Types from '../Types'
import _ from 'lodash'
import queryString from 'query-string'
import Tour from 'reactour'
import { isStateLoaded, useAnnotationState } from '../hooks/useAnnotations'

const { Content } = Layout
const { Paragraph } = Typography

const keyboardShortcutsMenu = (
    <Menu>
        <Menu.Item>
            <Tag color="#000000">click</Tag> Place red marker
    </Menu.Item>
        <Menu.Item>
            <Tag color="#000000">shift+click</Tag> Play to end of segment
    </Menu.Item>
        <Menu.Divider />
        <Menu.Item>
            <Tag color="#000000">s</Tag> Save annnotations
    </Menu.Item>
        <Menu.Item>
            <Tag color="#000000">u</Tag> Use reference to fill remainder
    </Menu.Item>
        <Menu.Item>
            <Tag color="#000000">p</Tag> Play clip
    </Menu.Item>
        <Menu.Item>
            <Tag color="#000000">t</Tag> Stop playing
    </Menu.Item>
        <Menu.Divider />
        <Menu.Item>
            <Tag color="#000000">d</Tag> Delete selection
    </Menu.Item>
        <Menu.Item>
            <Tag color="#000000">y</Tag> Play selection
    </Menu.Item>
        <Menu.Item>
            <Tag color="#000000">t</Tag> Edit transcript, at word if selected
    </Menu.Item>
        <Menu.Item>
            <Tag color="#000000">c</Tag> Clear selection
    </Menu.Item>
        <Menu.Divider />
        <Menu.Item>
            <Tag color="#000000">w</Tag> Start word at marker
    </Menu.Item>
        <Menu.Item>
            <Tag color="#000000">W</Tag> Start word after selected word
    </Menu.Item>
        <Menu.Divider />
        <Menu.Item>
            <Tag color="#000000">a</Tag> Toggle audio speed
    </Menu.Item>
        <Menu.Item>
            <Tag color="#000000">m</Tag> Mute audio
    </Menu.Item>
        <Menu.Divider />
        <Menu.Item>
            <Tag color="#000000">f</Tag> Save & forward 2s
    </Menu.Item>
        <Menu.Item>
            <Tag color="#000000">b</Tag> Save & backard 2s
    </Menu.Item>
        <Menu.Item>
            <Tag color="#000000">F</Tag> Save & forward 4s
    </Menu.Item>
        <Menu.Item>
            <Tag color="#000000">B</Tag> Save & backard 4s
    </Menu.Item>
        <Menu.Divider />
        <Menu.Item>
            <Tag color="#000000">left</Tag> Select word on the left
    </Menu.Item>
        <Menu.Item>
            <Tag color="#000000">right</Tag> Select word on the right
    </Menu.Item>
        <Menu.Item>
            <Tag color="#000000">shift-left</Tag> Word starts earlier
    </Menu.Item>
        <Menu.Item>
            <Tag color="#000000">shift-right</Tag> Word starts later
    </Menu.Item>
        <Menu.Item>
            <Tag color="#000000">ctrl-left</Tag> Word ends earlier
    </Menu.Item>
        <Menu.Item>
            <Tag color="#000000">ctrl-right</Tag> Word ends later
    </Menu.Item>
        <Menu.Item>
            <Tag color="#000000">shift-up</Tag> Shift word earlier
    </Menu.Item>
        <Menu.Item>
            <Tag color="#000000">shift-down</Tag> Shift word later
    </Menu.Item>
    </Menu>
)

const tourSteps = [
    {
        selector: '.spectrogram-with-annotations',
        content: 'We want to record what is being said and when each word starts and ends in an audio clip.',
    },
    {
        selector: '.spectrogram-with-annotations',
        content: 'You can click on the clip to play the audio starting at that location.',
    },
    {
        selector: '.transcript-area',
        content: 'Listen to the words and if we provided a transcript, compare the two',
    },
    {
        selector: '.change-transcript',
        content: 'Edit the transcript if any of the words are missing or wrong',
    },
    {
        selector: '.change-transcript',
        content: 'When you change the transcript, pay attention to special cases that can be confusing',
    },
    {
        selector: '.transcript-special-cases-1',
        content: 'What if someone is hard to understand or is not speaking English? (use # as the word)',
    },
    {
        selector: '.transcript-special-cases-2',
        content: 'What if multiple speakers overlap? (use % as the word)',
    },
    {
        selector: '.spectrogram-with-annotations',
        content: 'To start a new word that does not have boundaries yet, click on the audio and then on the word',
    },
    {
        selector: '.transcript-area',
        content: 'When you click a green word you select it, when you click a red word you try to add it',
    },
    {
        selector: '.annotated-word',
        content: 'You can then drag words and their beginnings and ends into position',
    },
] /* 'shift click will play all the way to the end.', TODO */

export default function EditorPage() {
    const onMessageRef = useRef<(level: Types.MessageLevel, value: string) => any>(() => null)
    const [state, setMovie, setStartTime, setDuration, setUser, setReferences, setDefaultReference] = useAnnotationState()

    const [isTourOpen, setOpenTour] = useState(false)
    const openTour = () => {
        setOpenTour(true)
    }
    const closeTour = () => {
        setOpenTour(false)
    }

    const onSave = useRef(() => null)
    const onReload = useRef(() => null)
    const onSavefn = useCallback(() => onSave.current(), [onSave])
    const onReloadFn = useCallback(() => onReload.current(), [onReload])

    useEffect(() => {
        document.title = 'Audio Annotation UI'
    }, [])

    const isChrome = window.navigator.userAgent.includes(' Chrome/')

    return isChrome ? (
        isStateLoaded(state) ? (
            <span>
                You must include query parameters for the movie, startTime, endTime, user, references, and defaultReference
      </span>
        ) : (
                <Layout className="layout">
                    <Tour steps={tourSteps} isOpen={isTourOpen} onRequestClose={closeTour} showNavigation={false} />
                    <PageHeader
                        className="site-page-header"
                        tags={<MessagePane onMessageRef={onMessageRef} />}
                        title="Audio annotation"
                        subTitle={
                            state.current.movie +
                            ' from ' +
                            state.current.startTime +
                            ' to ' +
                            Types.add(state.current.startTime!, state.current.duration!)
                        }
                        extra={[
                            <Button key="1" type="primary" icon={<ReloadOutlined />} danger={true} size="large" onClick={onReloadFn}>
                                Reload
            </Button>,
                            <Button
                                key="2"
                                className="element-saves"
                                icon={<SaveOutlined />}
                                type="primary"
                                size="large"
                                onClick={onSavefn}
                            >
                                Save
            </Button>,
                        ]}
                    >
                        <>
                            <Paragraph>
                                <Space size={10}>
                                    Instructions
                <a className="header-link">
                                        <InfoCircleTwoTone /> What am I doing? (disabled)
                </a>
                                    <a className="header-link" onClick={openTour}>
                                        <EyeTwoTone /> How does this tool work?
                </a>
                                    <Dropdown overlay={keyboardShortcutsMenu}>
                                        <a className="ant-dropdown-link" onClick={e => e.preventDefault()}>
                                            <ToolTwoTone /> Show me the keyboard shortcuts
                  </a>
                                    </Dropdown>
                                </Space>
                            </Paragraph>
                        </>
                    </PageHeader>
                    <Content className="main-content" style={{ padding: '0 20px', backgroundColor: 'transparent' }}>
                        <EditorUI
                            movie={state.current.movie!}
                            setMovie={setMovie}
                            startTime={state.current.startTime!}
                            setStartTime={setStartTime}
                            duration={state.current.duration!}
                            setDuration={setDuration}
                            user={state.current.user!}
                            setUser={setUser}
                            references={state.current.references!}
                            setReferences={setReferences}
                            defaultReference={state.current.defaultReference!}
                            setDefaultReference={setDefaultReference}
                            onMessageRef={onMessageRef}
                            onSave={onSave}
                            onReload={onReload}
                        />
                    </Content>
                </Layout>
            )
    ) : (
            <span>You must use Chrome to annotate due to bugs in Firefox and Safari.</span>
        )
}
